import crypto from 'node:crypto';
import { config } from '../config.js';
import { prisma } from '../prisma.js';
import { AppError } from '../utils/helpers.js';
import { calculateAiCreditMicros, estimateAiAudioSeconds, estimateAiInputTokens } from '../utils/ai-credit-pricing.js';
import * as infinitePay from './infinitepay.js';
import { complete } from './ai.js';

const MICROS_PER_CENT = 10_000n;
const MAX_OUTPUT_TOKENS = 1200;
const TOP_UP_AMOUNTS = new Set([500, 1000, 2000, 5000]);
const monthStart = () => {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
};

function requireAiService() {
  if (!config.ai.apiKey) throw new AppError(503, 'O atendimento Dm Soluções ainda não foi configurado.', 'AI_SERVICE_NOT_CONFIGURED');
  if (!config.ai.usdBrlRate) throw new AppError(503, 'O atendimento Dm Soluções ainda não foi configurado.', 'AI_SERVICE_NOT_CONFIGURED');
}

async function ensureWallet(userId, client = prisma) {
  return client.aiCreditWallet.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

function creditCharge(inputTokens, cachedInputTokens, outputTokens, audioSeconds = 0) {
  return calculateAiCreditMicros({
    inputTokens,
    cachedInputTokens,
    outputTokens,
    audioSeconds,
    usdBrlRate: config.ai.usdBrlRate,
    inputUsdPerMillion: config.ai.inputUsdPerMillion,
    cachedInputUsdPerMillion: config.ai.cachedInputUsdPerMillion,
    outputUsdPerMillion: config.ai.outputUsdPerMillion,
    transcriptionUsdPerMinute: config.ai.transcriptionUsdPerMinute,
  });
}

async function reserveAiCredits(userId, inputTokens, outputTokens, audioSeconds) {
  await ensureWallet(userId);
  const amountMicros = creditCharge(inputTokens, 0, outputTokens, audioSeconds);
  const reference = `hold:${crypto.randomUUID()}`;
  return prisma.$transaction(async (tx) => {
    const stale = await tx.aiCreditTransaction.findMany({
      where: { userId, type: 'reservation', createdAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
      select: { id: true, amountMicros: true },
    });
    for (const hold of stale) {
      const released = await tx.aiCreditTransaction.updateMany({
        where: { id: hold.id, type: 'reservation' },
        data: { type: 'cancelled', amountMicros: 0n },
      });
      if (released.count) {
        const wallet = await tx.aiCreditWallet.update({
          where: { userId },
          data: { balanceMicros: { increment: -hold.amountMicros } },
        });
        await tx.aiCreditTransaction.update({ where: { id: hold.id }, data: { balanceAfterMicros: wallet.balanceMicros } });
      }
    }
    const claimed = await tx.aiCreditWallet.updateMany({
      where: { userId, balanceMicros: { gte: amountMicros } },
      data: { balanceMicros: { decrement: amountMicros } },
    });
    if (!claimed.count) throw new AppError(402, 'Seus créditos da Dm Soluções acabaram. Recarregue para continuar.', 'AI_CREDIT_INSUFFICIENT');
    const wallet = await tx.aiCreditWallet.findUnique({ where: { userId } });
    const transaction = await tx.aiCreditTransaction.create({
      data: {
        userId, reference, type: 'reservation', amountMicros: -amountMicros,
        balanceAfterMicros: wallet.balanceMicros,
      },
    });
    return { transactionId: transaction.id, amountMicros };
  });
}

async function releaseAiCredits(userId, reservation) {
  await prisma.$transaction(async (tx) => {
    const held = await tx.aiCreditTransaction.findFirst({
      where: { id: reservation.transactionId, userId, type: 'reservation' },
    });
    if (!held) return;
    const wallet = await tx.aiCreditWallet.update({
      where: { userId },
      data: { balanceMicros: { increment: reservation.amountMicros } },
    });
    await tx.aiCreditTransaction.update({
      where: { id: held.id },
      data: { type: 'cancelled', amountMicros: 0n, balanceAfterMicros: wallet.balanceMicros },
    });
  });
}

async function settleAiUsage(userId, reservation, usage) {
  const actualMicros = creditCharge(usage.inputTokens, usage.cachedInputTokens, usage.outputTokens, usage.audioSeconds);
  await prisma.$transaction(async (tx) => {
    const held = await tx.aiCreditTransaction.findFirst({
      where: { id: reservation.transactionId, userId, type: 'reservation' },
    });
    if (!held) throw new AppError(409, 'Não foi possível registrar o consumo da Dm Soluções.', 'AI_CREDIT_SETTLEMENT_FAILED');
    const adjustment = reservation.amountMicros - actualMicros;
    const wallet = await tx.aiCreditWallet.update({
      where: { userId },
      data: { balanceMicros: { increment: adjustment } },
    });
    await tx.aiCreditTransaction.update({
      where: { id: held.id },
      data: {
        type: 'usage', amountMicros: -actualMicros, balanceAfterMicros: wallet.balanceMicros,
        inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens, audioSeconds: Math.ceil(usage.audioSeconds || 0),
      },
    });
  });
  return actualMicros;
}

export async function runCreditedCompletion(userId, request) {
  requireAiService();
  const inputTokens = estimateAiInputTokens(request);
  const audioSeconds = estimateAiAudioSeconds(request.attachments);
  const reservation = await reserveAiCredits(userId, inputTokens, MAX_OUTPUT_TOKENS, audioSeconds);
  let result;
  try {
    result = await complete({
      ...request,
      provider: 'openai',
      model: config.ai.model,
      apiKey: config.ai.apiKey,
      maxTokens: MAX_OUTPUT_TOKENS,
    });
  } catch (error) {
    await releaseAiCredits(userId, reservation);
    if (['AI_CREDENTIAL_INVALID', 'AI_PROVIDER_LIMIT', 'AI_PROVIDER_ERROR', 'AI_PROVIDER_UNAVAILABLE'].includes(error.code)) {
      throw new AppError(503, 'A Dm Soluções está temporariamente indisponível. Tente novamente em instantes.', error.code);
    }
    throw error;
  }
  const usage = { ...result, audioSeconds: result.audioSeconds > 0 ? result.audioSeconds : audioSeconds };
  const chargedMicros = await settleAiUsage(userId, reservation, usage);
  return { ...usage, chargedMicros };
}

export async function aiCreditStatus(userId) {
  const wallet = await ensureWallet(userId);
  const since = monthStart();
  const [monthly, transactions] = await Promise.all([
    prisma.aiCreditTransaction.aggregate({
      where: { userId, type: 'usage', createdAt: { gte: since } },
      _sum: { amountMicros: true, inputTokens: true, cachedInputTokens: true, outputTokens: true, audioSeconds: true },
    }),
    prisma.aiCreditTransaction.findMany({
      where: { userId, type: { in: ['usage', 'topup', 'admin_adjustment'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, type: true, amountMicros: true, inputTokens: true, cachedInputTokens: true, outputTokens: true, audioSeconds: true, adminUserId: true, note: true, createdAt: true },
    }),
  ]);
  return {
    balanceMicros: wallet.balanceMicros.toString(),
    monthlySpentMicros: String(-(monthly._sum.amountMicros || 0n)),
    monthlyTokens: {
      input: monthly._sum.inputTokens || 0,
      cachedInput: monthly._sum.cachedInputTokens || 0,
      output: monthly._sum.outputTokens || 0,
      audioSeconds: monthly._sum.audioSeconds || 0,
    },
    transactions: transactions.map((item) => ({
      ...item, amountMicros: item.amountMicros.toString(), createdAt: item.createdAt.getTime(),
    })),
    configured: Boolean(config.ai.apiKey && config.ai.usdBrlRate),
    paymentsConfigured: Boolean(config.infinitepay.handle),
  };
}

export async function createAiCreditCheckout(user, amountCents, purchaser = user) {
  if (!config.infinitepay.handle) throw new AppError(503, 'A recarga de créditos ainda não está configurada.', 'PAYMENTS_NOT_CONFIGURED');
  requireAiService();
  if (!TOP_UP_AMOUNTS.has(amountCents)) throw new AppError(400, 'Escolha uma recarga de R$ 5, R$ 10, R$ 20 ou R$ 50.');
  const orderNsu = `ai-${user.id}-${crypto.randomUUID()}`;
  const topUp = await prisma.aiCreditTopUp.create({ data: { userId: user.id, orderNsu, amountCents } });
  const phone = String(purchaser.phone || '').replace(/\D/g, '');
  let url;
  try {
    url = await infinitePay.createCheckout({
      orderNsu,
      description: 'Créditos Dm Soluções',
      amountCents,
      redirectUrl: `${config.appUrl}/ia?credit_order_nsu=${encodeURIComponent(orderNsu)}`,
      webhookUrl: config.appUrl.startsWith('https://') ? `${config.appUrl}/api/webhooks/ai-credits` : undefined,
      customer: { name: purchaser.name, email: purchaser.email, ...(phone ? { phone_number: `+${phone}` } : {}) },
    });
  } catch (error) {
    await prisma.aiCreditTopUp.update({ where: { id: topUp.id }, data: { status: 'failed' } });
    throw error;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('URL inválida');
  } catch {
    await prisma.aiCreditTopUp.update({ where: { id: topUp.id }, data: { status: 'failed' } });
    throw new AppError(502, 'A InfinitePay não retornou um link de pagamento seguro.', 'INFINITEPAY_ERROR');
  }
  return { url };
}

export async function settleAiCreditTopUp({ orderNsu, transactionNsu, slug, receiptUrl, userId }) {
  const topUp = await prisma.aiCreditTopUp.findFirst({
    where: { orderNsu, ...(userId ? { userId } : {}) },
  });
  if (!topUp) throw new AppError(404, 'Recarga de créditos não encontrada.');
  if (topUp.status === 'paid') return true;
  if (!slug || !transactionNsu) throw new AppError(400, 'Dados do pagamento incompletos.');
  const result = await infinitePay.checkPayment({ orderNsu, transactionNsu, slug });
  if (!result.paid) throw new AppError(402, 'A InfinitePay ainda não confirmou este pagamento. Aguarde e tente novamente.', 'NOT_PAID');
  if (result.amount !== topUp.amountCents) throw new AppError(400, 'O valor pago não confere com a recarga.');
  await ensureWallet(topUp.userId);
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.aiCreditTopUp.updateMany({
      where: { id: topUp.id, status: 'pending' },
      data: {
        status: 'paid', slug, transactionNsu, receiptUrl: receiptUrl || null, paidAt: new Date(),
      },
    });
    if (!claimed.count) return false;
    const amountMicros = BigInt(topUp.amountCents) * MICROS_PER_CENT;
    const wallet = await tx.aiCreditWallet.update({
      where: { userId: topUp.userId },
      data: { balanceMicros: { increment: amountMicros } },
    });
    await tx.aiCreditTransaction.create({
      data: {
        userId: topUp.userId, reference: `topup:${topUp.id}`, type: 'topup',
        amountMicros, balanceAfterMicros: wallet.balanceMicros,
      },
    });
    return true;
  });
}
