import { AppError } from '../utils/helpers.js';

const ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  claude: 'https://api.anthropic.com/v1/messages',
};

function providerError(response) {
  if (response.status === 401 || response.status === 403) {
    return new AppError(400, 'A credencial do provedor foi recusada. Confira a chave e as permissões.', 'AI_CREDENTIAL_INVALID');
  }
  if (response.status === 429) return new AppError(429, 'O provedor limitou as chamadas ou está sem créditos. Verifique a conta do provedor.', 'AI_PROVIDER_LIMIT');
  console.warn(`[ia] erro do provedor (HTTP ${response.status}).`);
  return new AppError(502, 'O provedor de IA não conseguiu concluir a solicitação. Tente novamente.', 'AI_PROVIDER_ERROR');
}

async function postJson(url, headers, body) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new AppError(502, 'Não foi possível conectar ao provedor de IA. Tente novamente.', 'AI_PROVIDER_UNAVAILABLE');
  }
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw providerError(response);
  return data;
}

export async function complete({ provider, model, apiKey, prompt, history = [], input }) {
  let data;
  if (provider === 'openai') {
    data = await postJson(ENDPOINTS.openai, { Authorization: `Bearer ${apiKey}` }, {
      model,
      messages: [
        { role: 'system', content: prompt },
        ...history.map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: item.content })),
        { role: 'user', content: input },
      ],
      max_tokens: 1200,
    });
    const choice = data.choices?.[0];
    return {
      text: String(choice?.message?.content || '').trim(),
      inputTokens: Number(data.usage?.prompt_tokens) || 0,
      outputTokens: Number(data.usage?.completion_tokens) || 0,
    };
  }
  if (provider === 'claude') {
    data = await postJson(ENDPOINTS.claude, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, {
      model,
      system: prompt,
      messages: [
        ...history.map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: item.content })),
        { role: 'user', content: input },
      ],
      max_tokens: 1200,
    });
    return {
      text: (data.content || []).filter((item) => item.type === 'text').map((item) => item.text).join('').trim(),
      inputTokens: Number(data.usage?.input_tokens) || 0,
      outputTokens: Number(data.usage?.output_tokens) || 0,
    };
  }
  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    data = await postJson(url, { 'x-goog-api-key': apiKey }, {
      systemInstruction: { parts: [{ text: prompt }] },
      contents: [
        ...history.map((item) => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content }] })),
        { role: 'user', parts: [{ text: input }] },
      ],
      generationConfig: { maxOutputTokens: 1200 },
    });
    return {
      text: (data.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('').trim(),
      inputTokens: Number(data.usageMetadata?.promptTokenCount) || 0,
      outputTokens: Number(data.usageMetadata?.candidatesTokenCount) || 0,
    };
  }
  throw new AppError(400, 'Provedor de IA inválido.');
}
