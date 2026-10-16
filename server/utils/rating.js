// Avaliação de pontualidade de um cliente (de 1 a 5 estrelas).
//
//   5 estrelas = paga em dia (ou antes)
//   4 estrelas = atrasa 1 dia, em média
//   3 estrelas = atrasa 2 dias, 2 estrelas = 3 dias, 1 estrela = 4 dias ou mais
//
// Dias de atraso = dia em que pagou - vencimento (pagar antes do vencimento conta como 0).
// A média usa os últimos pagamentos do cliente, para a nota acompanhar o comportamento recente.
const DAY_MS = 24 * 60 * 60 * 1000;

export const MAX_STARS = 5;
export const RATING_WINDOW = 12; // quantos pagamentos recentes entram na conta

// Datas "só dia" ficam em 00:00 UTC, então a diferença é sempre um número inteiro de dias.
export const daysBetween = (from, to) => Math.round((to.getTime() - from.getTime()) / DAY_MS);
export const lateDays = (dueDate, paidAt) => Math.max(0, daysBetween(dueDate, paidAt));

export const starsFromAvgLate = (avgLateDays) => Math.min(MAX_STARS, Math.max(1, MAX_STARS - Math.round(avgLateDays)));

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// payments: [{ dueDate: Date, paidAt: Date, amountCents }], do mais recente para o mais antigo.
export function rateClient(payments, window = RATING_WINDOW) {
  const recent = payments.slice(0, window);
  const lates = recent.map((p) => lateDays(p.dueDate, p.paidAt));
  const avg = lates.reduce((a, b) => a + b, 0) / lates.length;
  return {
    count: payments.length,
    avgLateDays: Math.round(avg * 10) / 10,
    maxLateDays: Math.max(...lates),
    onTimeCount: lates.filter((d) => d === 0).length,
    // Dia do mês em que o cliente costuma pagar (mediana dos dias de pagamento).
    usualDay: median(recent.map((p) => p.paidAt.getUTCDate())),
    stars: starsFromAvgLate(avg),
    ratedCount: recent.length,
    totalCents: payments.reduce((a, p) => a + p.amountCents, 0),
    lastPaidAt: payments[0].paidAt,
  };
}
