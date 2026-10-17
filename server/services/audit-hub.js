// Canal de tempo real da auditoria: cada aba aberta do usuário recebe os eventos (Server-Sent Events).
const clients = new Map(); // userId -> Set<res>
const MAX_TABS = 6;

export function subscribe(userId, res) {
  let set = clients.get(userId);
  if (!set) clients.set(userId, (set = new Set()));
  while (set.size >= MAX_TABS) {
    const oldest = set.values().next().value;
    set.delete(oldest);
    oldest.end();
  }
  set.add(res);
  return () => {
    set.delete(res);
    if (!set.size) clients.delete(userId);
  };
}

export function publish(userId, event) {
  const set = clients.get(userId);
  if (!set) return;
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) res.write(frame);
}

export const listenerCount = (userId) => clients.get(userId)?.size || 0;
