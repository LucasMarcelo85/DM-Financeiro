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
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new AppError(502, 'Não foi possível conectar ao provedor de IA. Tente novamente.', 'AI_PROVIDER_UNAVAILABLE');
  }
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw providerError(response);
  return data;
}

const baseMime = (mime) => String(mime || '').split(';')[0].trim().toLowerCase();
const isTextMime = (mime) => /^text\//.test(mime) || ['application/json', 'application/xml', 'text/csv'].includes(mime);
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

async function transcribeAudio(apiKey, attachment) {
  const form = new FormData();
  form.append('model', 'whisper-1');
  form.append('file', new Blob([Buffer.from(attachment.base64, 'base64')], { type: baseMime(attachment.mime) }), attachment.name || 'audio.ogg');
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(60000),
    });
  } catch { return ''; }
  if (!response.ok) return '';
  const data = await response.json().catch(() => ({}));
  return String(data.text || '').trim();
}

// Separa o que o provedor lê direto (imagem, PDF, áudio) do que vira texto (transcrição, arquivos de texto, avisos).
async function prepareInput(provider, apiKey, input, attachments) {
  const notes = [];
  const media = [];
  for (const item of attachments) {
    const mime = baseMime(item.mime);
    const label = item.name ? `"${item.name}"` : mime || 'arquivo';
    if (isTextMime(mime)) {
      notes.push(`[Conteúdo do arquivo ${label}]\n${Buffer.from(item.base64, 'base64').toString('utf8').slice(0, 20000)}`);
    } else if (IMAGE_MIMES.has(mime)) {
      if (provider === 'claude' && item.size > 5 * 1024 * 1024) notes.push(`[A imagem ${label} é grande demais para ser analisada. Peça uma versão menor.]`);
      else media.push({ kind: 'image', mime, base64: item.base64 });
    } else if (mime === 'application/pdf') {
      media.push({ kind: 'pdf', mime, base64: item.base64, name: item.name || 'documento.pdf' });
    } else if (item.kind === 'audio' || mime.startsWith('audio/')) {
      if (provider === 'gemini') media.push({ kind: 'audio', mime, base64: item.base64 });
      else if (provider === 'openai') {
        const text = await transcribeAudio(apiKey, item);
        notes.push(text ? `[Transcrição do áudio enviado pelo cliente]\n${text}` : '[O cliente enviou um áudio que não pôde ser transcrito. Peça para repetir por escrito.]');
      } else notes.push('[O cliente enviou um áudio, mas este provedor não processa áudio. Peça gentilmente que escreva a mensagem.]');
    } else {
      notes.push(`[O cliente enviou o arquivo ${label}, que este assistente não consegue ler. Peça outra forma de envio (PDF, imagem ou texto).]`);
    }
  }
  return { text: [input, ...notes].filter(Boolean).join('\n\n'), media };
}

export async function complete({ provider, model, apiKey, prompt, history = [], input, attachments = [], maxTokens = 1200 }) {
  let data;
  const prepared = await prepareInput(provider, apiKey, input, attachments);
  const userText = prepared.text || 'O cliente enviou uma mídia.';
  const outputLimit = Number.isInteger(maxTokens) ? Math.min(12000, Math.max(256, maxTokens)) : 1200;
  if (provider === 'openai') {
    data = await postJson(ENDPOINTS.openai, { Authorization: `Bearer ${apiKey}` }, {
      model,
      messages: [
        { role: 'system', content: prompt },
        ...history.map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: item.content })),
        {
          role: 'user',
          content: prepared.media.length ? [
            { type: 'text', text: userText },
            ...prepared.media.map((item) => (item.kind === 'image'
              ? { type: 'image_url', image_url: { url: `data:${item.mime};base64,${item.base64}` } }
              : { type: 'file', file: { filename: item.name, file_data: `data:${item.mime};base64,${item.base64}` } })),
          ] : userText,
        },
      ],
      max_tokens: outputLimit,
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
        {
          role: 'user',
          content: [
            ...prepared.media.map((item) => (item.kind === 'image'
              ? { type: 'image', source: { type: 'base64', media_type: item.mime, data: item.base64 } }
              : { type: 'document', source: { type: 'base64', media_type: item.mime, data: item.base64 } })),
            { type: 'text', text: userText },
          ],
        },
      ],
      max_tokens: outputLimit,
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
        { role: 'user', parts: [...prepared.media.map((item) => ({ inlineData: { mimeType: item.mime, data: item.base64 } })), { text: userText }] },
      ],
      generationConfig: { maxOutputTokens: outputLimit },
    });
    return {
      text: (data.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('').trim(),
      inputTokens: Number(data.usageMetadata?.promptTokenCount) || 0,
      outputTokens: Number(data.usageMetadata?.candidatesTokenCount) || 0,
    };
  }
  throw new AppError(400, 'Provedor de IA inválido.');
}
