// Textos dos planos para a tela (os números vêm do servidor: server/plans.js).
const n = (v, one, many) => ({ value: v, label: v === 1 ? one : many });

// Linhas da lista de recursos: { ok, value?, label }. ok=false aparece com X.
export function planFeatureRows(p) {
  return [
    { ok: true, ...n(p.instances, 'WhatsApp para cobranças e lembretes', 'WhatsApps para cobranças e lembretes') },
    { ok: true, ...n(p.auditInstances, 'número para auditoria', 'números para auditoria') },
    { ok: true, ...n(p.contracts, 'modelo de contrato', 'modelos de contrato') },
    { ok: true, label: 'Cobranças e lembretes automáticos' },
    { ok: true, label: 'Conexão por QR Code ou API oficial da Meta' },
    { ok: true, label: 'Auditoria das conversas em tempo real' },
    { ok: true, label: 'Etiquetas, anotações e busca por palavra-chave' },
    { ok: true, label: 'Editor de contratos com importação de arquivos' },
    { ok: Boolean(p.auditSend), label: 'Enviar mensagens pela auditoria' },
  ];
}

export const PERIOD_SUFFIX = { mensal: 'por mês', semestral: 'por 6 meses', anual: 'por 12 meses' };
