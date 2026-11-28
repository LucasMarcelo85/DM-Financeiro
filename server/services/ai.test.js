import test from 'node:test';
import assert from 'node:assert/strict';
import { complete } from './ai.js';

const jsonResponse = (value) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

test('sends image input through the current Dm Soluções chat model', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return jsonResponse({
      choices: [{ message: { content: 'Imagem recebida.' } }],
      usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 0 } },
    });
  };
  try {
    const result = await complete({
      provider: 'openai',
      model: 'gpt-6.1-terra',
      apiKey: 'test-key',
      prompt: 'Atenda o cliente.',
      input: 'O que aparece na imagem?',
      attachments: [{ kind: 'image', mime: 'image/jpeg', base64: Buffer.from('image').toString('base64') }],
    });
    assert.equal(request.model, 'gpt-6.1-terra');
    assert.equal(request.max_completion_tokens, 1200);
    assert.equal(request.messages[0].role, 'developer');
    assert.equal(request.messages[1].content[1].type, 'image_url');
    assert.equal(result.text, 'Imagem recebida.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('transcribes OGG audio with GPT-Transcribe before creating the reply', async () => {
  const originalFetch = globalThis.fetch;
  let transcriptionModel;
  let transcriptionFormat;
  let completion;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/audio/transcriptions')) {
      transcriptionModel = options.body.get('model');
      transcriptionFormat = options.body.get('response_format');
      return jsonResponse({ text: 'Preciso de ajuda.', duration: 12 });
    }
    completion = JSON.parse(options.body);
    return jsonResponse({
      choices: [{ message: { content: 'Claro, posso ajudar.' } }],
      usage: { prompt_tokens: 120, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 0 } },
    });
  };
  try {
    const result = await complete({
      provider: 'openai',
      model: 'gpt-6.1-terra',
      apiKey: 'test-key',
      prompt: 'Atenda o cliente.',
      input: '',
      attachments: [{
        kind: 'audio', mime: 'audio/ogg', name: 'voice.ogg',
        base64: Buffer.from('audio').toString('base64'),
      }],
    });
    assert.equal(transcriptionModel, 'gpt-transcribe');
    assert.equal(transcriptionFormat, 'json');
    assert.match(completion.messages[1].content, /Preciso de ajuda/);
    assert.equal(result.audioSeconds, 12);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
