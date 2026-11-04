// Ações por área (menu) e limites extras que o dono da loja reparte com o aplicativo.
export const ACTIONS = ['ver', 'criar', 'editar', 'excluir'];

export const ACTION_BY_METHOD = { GET: 'ver', HEAD: 'ver', POST: 'criar', PUT: 'editar', PATCH: 'editar', DELETE: 'excluir' };

// instances sai do limite do plano; os demais são tetos próprios do app.
export const LIMIT_KEYS = ['instances', 'apiTokens', 'aiAgents', 'aiResponses', 'aiContacts'];
export const MAX_LIMIT = 2_147_483_647;

// Devolve { área: [ações] } só das áreas liberadas; "ver" sempre acompanha as demais ações.
export function cleanActions(raw, areas) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const area of areas) {
    const list = Array.isArray(src[area]) ? src[area].filter((a) => ACTIONS.includes(a)) : ACTIONS;
    out[area] = ACTIONS.filter((a) => a === 'ver' || list.includes(a));
  }
  return out;
}

export function hasAction(actionsMap, area, action) {
  const list = actionsMap && typeof actionsMap === 'object' ? actionsMap[area] : undefined;
  return !Array.isArray(list) || list.includes(action);
}

export function readLimits(store) {
  const raw = store?.appLimits && typeof store.appLimits === 'object' ? store.appLimits : {};
  const out = {};
  for (const key of LIMIT_KEYS) {
    const n = Number(raw[key]);
    if (raw[key] !== undefined && raw[key] !== null && Number.isInteger(n) && n >= 0) out[key] = n;
  }
  return out;
}
