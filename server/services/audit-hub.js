// Canal de tempo real da auditoria, isolado por usuário e pela loja principal/app.
const clients = new Map(); // userId -> Map<scope, Set<res>>
const MAX_TABS = 6;

export function subscribe(userId, scope, res) {
  let scopes = clients.get(userId);
  if (!scopes) clients.set(userId, (scopes = new Map()));
  let set = scopes.get(scope);
  if (!set) scopes.set(scope, (set = new Set()));
  while (set.size >= MAX_TABS) {
    const oldest = set.values().next().value;
    set.delete(oldest);
    oldest.end();
  }
  set.add(res);
  return () => {
    set.delete(res);
    if (!set.size) scopes.delete(scope);
    if (!scopes.size) clients.delete(userId);
  };
}

export function publish(userId, event, scope = 'main') {
  const set = clients.get(userId)?.get(scope);
  if (!set) return;
  const frame = `data: ${JSON.stringify({ ...event, auditScope: scope })}\n\n`;
  for (const res of set) res.write(frame);
}

export const listenerCount = (userId, scope) => clients.get(userId)?.get(scope)?.size || 0;
