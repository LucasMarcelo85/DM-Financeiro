import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAiCreditMicros, estimateAiAudioSeconds, estimateAiInputTokens } from './ai-credit-pricing.js';

test('charges exactly twice GPT-6.1 Terra token prices in USD/BRL micros', () => {
  assert.equal(calculateAiCreditMicros({
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    usdBrlRate: 5.5,
  }), 66_000_000n);
});

test('prices cached input at the published GPT-6.1 Terra rate', () => {
  const charge = calculateAiCreditMicros({
    inputTokens: 1_000_000,
    cachedInputTokens: 500_000,
    outputTokens: 0,
    usdBrlRate: 5.5,
  });
  assert.equal(charge, 5_775_000n);
});

test('rounds a non-zero token charge up to one micro-real', () => {
  assert.equal(calculateAiCreditMicros({
    inputTokens: 1,
    outputTokens: 0,
    usdBrlRate: 5.5,
  }), 11n);
});

test('reserves input tokens for text and supported media', () => {
  assert.equal(estimateAiInputTokens({
    prompt: 'a'.repeat(100),
    input: 'b'.repeat(100),
    attachments: [{ mime: 'image/jpeg' }, { mime: 'application/pdf', size: 2_000 }],
  }), 16_196);
});

test('charges double the published GPT-Transcribe rate for transcribed audio', () => {
  assert.equal(calculateAiCreditMicros({
    inputTokens: 0,
    outputTokens: 0,
    audioSeconds: 60,
    usdBrlRate: 5.5,
  }), 49_500n);
});

test('estimates audio duration conservatively from uploaded bytes', () => {
  assert.equal(estimateAiAudioSeconds([{ kind: 'audio', size: 10_000 }]), 5);
});
