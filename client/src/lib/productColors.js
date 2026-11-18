const COLOR_NAMES = {
  amarelo: '#ffff00',
  azul: '#0000ff',
  'azul claro': '#add8e6',
  'azul escuro': '#00008b',
  bege: '#f5f5dc',
  branco: '#ffffff',
  cinza: '#808080',
  dourado: '#ffd700',
  laranja: '#ffa500',
  marrom: '#a52a2a',
  preto: '#000000',
  rosa: '#ffc0cb',
  roxo: '#800080',
  verde: '#008000',
  vermelho: '#ff0000',
};

export function colorHexForName(name) {
  const value = String(name || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  return COLOR_NAMES[normalized] || null;
}

export function colorNameForHex(hex) {
  const value = String(hex || '').toLowerCase();
  return Object.entries(COLOR_NAMES).find(([, colorHex]) => colorHex === value)?.[0] || '';
}
