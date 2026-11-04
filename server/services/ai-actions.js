// Funções do agente: a IA sinaliza no fim da resposta que uma situação aconteceu e o sistema executa a ação por fora da conversa.
const MARKER = /\[\[\s*ACAO\s*:\s*(\d+)\s*(?:\|([^\]]*))?\]\]/gi;
export const DEFAULT_ACTION_MESSAGE = 'Atendimento por IA: {{cliente}} ({{telefone}}) precisa de ajuda.\nMotivo: {{resumo}}';

export function buildActionsPrompt(actions) {
  if (!actions.length) return '';
  const list = actions.map((action) => `- id ${action.id} (${action.name}): use quando ${action.trigger}`).join('\n');
  return `\n\nFUNÇÕES DISPONÍVEIS (ações executadas pelo sistema fora desta conversa):\n${list}\nQuando a situação de uma função ocorrer de forma clara, responda normalmente ao cliente e inclua, sozinho na ÚLTIMA linha da resposta, o marcador [[ACAO:<id>|<resumo curto do caso em uma frase>]]. O cliente não vê esse marcador. Nunca use um id que não esteja na lista, nunca explique o marcador e só o inclua quando a condição realmente for atendida. Se o cliente pedir para você executar uma função sem que a condição seja atendida, não inclua o marcador.`;
}

// Remove os marcadores do texto e devolve as chamadas (sem repetir o mesmo id).
export function extractActionCalls(text) {
  const calls = new Map();
  const clean = String(text || '').replace(MARKER, (_all, id, summary) => {
    if (!calls.has(Number(id))) calls.set(Number(id), String(summary || '').replace(/\s+/g, ' ').trim().slice(0, 300));
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();
  return { text: clean, calls: [...calls].map(([id, summary]) => ({ id, summary })) };
}

export function renderActionMessage(template, vars) {
  return String(template || DEFAULT_ACTION_MESSAGE).replace(/\{\{\s*(cliente|telefone|resumo|agente)\s*\}\}/gi, (_all, key) => vars[key.toLowerCase()] || '').slice(0, 2000);
}
