const COLOR_ENTRIES = [
  ['Azul-marinho', '#001f3f'],
  ['Azul', '#0000ff'],
  ['Preto', '#000000'],
  ['Branco', '#ffffff'],
  ['Bege', '#f5f5dc'],
  ['Café', '#6f4e37'],
  ['Capuccino', '#c8a47e'],
  ['Vinho', '#722f37'],
  ['Azul celeste', '#87ceeb'],
  ['Roxo escuro', '#4b0082'],
  ['Azul royal', '#4169e1'],
  ['Chocolate', '#7b3f00'],
  ['Verde petróleo', '#005f5f'],
  ['Verde', '#008000'],
  ['Azul bebê', '#89cff0'],
  ['Rosa', '#ffc0cb'],
  ['Lavanda', '#e6e6fa'],
  ['Verde militar', '#4b5320'],
  ['Off-white', '#f8f6f0'],
  ['Roxo', '#800080'],
  ['Chumbo', '#36454f'],
  ['Marrom', '#a52a2a'],
  ['Rosa chiclete', '#ff69b4'],
  ['Telha', '#b7410e'],
  ['Azul claro', '#add8e6'],
  ['Cinza claro', '#d3d3d3'],
  ['Pistache', '#93c572'],
  ['Verde limão', '#32cd32'],
  ['Vermelho', '#ff0000'],
  ['Amarelo', '#ffff00'],
  ['Azul escuro', '#00008b'],
  ['Azul petróleo', '#005f73'],
  ['Azul piscina', '#00b4d8'],
  ['Azul turquesa', '#40e0d0'],
  ['Caqui', '#c3b091'],
  ['Areia', '#c2b280'],
  ['Caramelo', '#c68e17'],
  ['Cinza', '#808080'],
  ['Cinza escuro', '#555555'],
  ['Creme', '#fffdd0'],
  ['Dourado', '#ffd700'],
  ['Grafite', '#41424c'],
  ['Laranja', '#ffa500'],
  ['Lilás', '#c8a2c8'],
  ['Magenta', '#ff00ff'],
  ['Marrom claro', '#b5651d'],
  ['Marrom escuro', '#4b2e2b'],
  ['Mostarda', '#d4a017'],
  ['Nude', '#d2a679'],
  ['Oliva', '#808000'],
  ['Prata', '#c0c0c0'],
  ['Rosa claro', '#f4c2c2'],
  ['Rosa escuro', '#c71585'],
  ['Salmão', '#fa8072'],
  ['Terracota', '#e2725b'],
  ['Turquesa', '#40e0d0'],
  ['Verde água', '#7fffd4'],
  ['Verde claro', '#90ee90'],
  ['Verde escuro', '#006400'],
  ['Verde oliva', '#808000'],
];

const FEMININE_FORMS = {
  preta: 'preto',
  branca: 'branco',
  amarela: 'amarelo',
  vermelha: 'vermelho',
  roxa: 'roxo',
  dourada: 'dourado',
  prateada: 'prata',
  marinha: 'marinho',
  clara: 'claro',
  escura: 'escuro',
};

const COLOR_ALIASES = {
  cappuccino: 'capuccino',
  capciono: 'capuccino',
  pink: 'rosa chiclete',
  fucsia: 'magenta',
  khaki: 'caqui',
};

function normalizedWords(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[-‐‑‒–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

export function normalizeProductColorName(value) {
  const words = normalizedWords(value).map((word) => FEMININE_FORMS[word] || word);
  const normalized = words.join(' ');
  return COLOR_ALIASES[normalized] || normalized;
}

const COLOR_HEX_BY_NAME = Object.fromEntries(
  COLOR_ENTRIES.map(([name, hex]) => [normalizeProductColorName(name), hex]),
);

export const PRODUCT_COLOR_SUGGESTIONS = COLOR_ENTRIES.map(([name]) => name);
export const PRODUCT_COLOR_VARIATION_SUGGESTIONS = [
  'Sortido',
  'Sortida',
  'Variado',
  'Variada',
  'Variados',
  'Variadas',
  'Multicolor',
  'Colorido',
  'Colorida',
  'Cores sortidas',
  'Cores variadas',
  'Estampado',
  'Estampada',
  'Estampas variadas',
];

export function colorHexForName(name) {
  const value = String(name || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  return COLOR_HEX_BY_NAME[normalizeProductColorName(value)] || null;
}

export function colorNameForHex(hex) {
  const value = String(hex || '').toLowerCase();
  return COLOR_ENTRIES.find(([, colorHex]) => colorHex === value)?.[0] || '';
}
