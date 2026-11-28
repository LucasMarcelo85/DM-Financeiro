const MICROS_PER_CURRENCY_UNIT = 1_000_000n;
const TOKENS_PER_MILLION = 1_000_000n;

export function calculateAiCreditMicros({
  inputTokens, cachedInputTokens = 0, outputTokens, audioSeconds = 0, usdBrlRate,
  inputUsdPerMillion = 1, cachedInputUsdPerMillion = 0.05,
  outputUsdPerMillion = 5, transcriptionUsdPerMinute = 0.0045,
}) {
  const inputs = Math.max(0, Math.trunc(Number(inputTokens) || 0));
  const cached = Math.min(inputs, Math.max(0, Math.trunc(Number(cachedInputTokens) || 0)));
  const outputs = Math.max(0, Math.trunc(Number(outputTokens) || 0));
  const rateMicros = Math.round(Number(usdBrlRate) * 1_000_000);
  if (!Number.isSafeInteger(rateMicros) || rateMicros < 1) throw new Error('A cotação USD/BRL não está configurada.');

  const weightedTokenMicros = BigInt(inputs - cached) * BigInt(Math.round(inputUsdPerMillion * 1_000_000))
    + BigInt(cached) * BigInt(Math.round(cachedInputUsdPerMillion * 1_000_000))
    + BigInt(outputs) * BigInt(Math.round(outputUsdPerMillion * 1_000_000));
  const tokenNumerator = weightedTokenMicros * 2n * BigInt(rateMicros);
  const tokenDenominator = TOKENS_PER_MILLION * MICROS_PER_CURRENCY_UNIT;
  const tokenCharge = (tokenNumerator + tokenDenominator - 1n) / tokenDenominator;
  const seconds = Math.max(0, Math.ceil(Number(audioSeconds) || 0));
  const transcriptionUsdMicrosPerSecond = BigInt(Math.round(transcriptionUsdPerMinute * 1_000_000 / 60));
  const audioNumerator = BigInt(seconds) * transcriptionUsdMicrosPerSecond * 2n * BigInt(rateMicros);
  const audioDenominator = MICROS_PER_CURRENCY_UNIT;
  const audioCharge = (audioNumerator + audioDenominator - 1n) / audioDenominator;
  return tokenCharge + audioCharge;
}

export function estimateAiInputTokens({ prompt, history = [], input, attachments = [] }) {
  const characters = [
    prompt,
    input,
    ...history.map((item) => item.content || ''),
  ].reduce((sum, value) => sum + String(value || '').length, 0);
  const textTokens = Math.ceil(characters / 2);
  const mediaTokens = attachments.reduce((sum, item) => {
    if (String(item.mime || '').startsWith('image/')) return sum + 4096;
    if (item.mime === 'application/pdf') return sum + Math.max(12000, Math.ceil((item.size || 0) / 500));
    if (item.kind === 'audio' || String(item.mime || '').startsWith('audio/')) return sum + Math.max(12000, Math.ceil((item.size || 0) / 100));
    return sum;
  }, 0);
  return textTokens + mediaTokens;
}

export function estimateAiAudioSeconds(attachments = []) {
  return attachments.reduce((sum, item) => {
    if (item.kind !== 'audio' && !String(item.mime || '').startsWith('audio/')) return sum;
    return sum + Math.max(1, Math.ceil((item.size || 0) / 2000));
  }, 0);
}
