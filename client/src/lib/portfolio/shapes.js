// Formas 2D do portfólio. Os contornos são desenhados em coordenadas de 0 a 1 (caixa do elemento), então esticam junto com ele.
// Usados para recortar formas (clip-path), máscaras de imagem e o contorno (borda) das formas.

const poly = (pts) => `M${pts.map((p) => p.join(' ')).join('L')}z`;

function star(n = 5, inner = 0.4) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 ? inner : 1;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return poly(pts.map(([x, y]) => [+((x - x0) / (x1 - x0)).toFixed(4), +((y - y0) / (y1 - y0)).toFixed(4)])); // ocupa toda a caixa
}

export const SHAPE_PATHS = {
  rect: 'M0 0H1V1H0z',
  circle: 'M0.5 0A0.5 0.5 0 1 1 0.5 1A0.5 0.5 0 1 1 0.5 0z',
  triangle: poly([[0.5, 0], [1, 1], [0, 1]]),
  diamond: poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]),
  pentagon: poly([[0.5, 0], [1, 0.382], [0.809, 1], [0.191, 1], [0, 0.382]]),
  hexagon: poly([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]),
  octagon: poly([[0.3, 0], [0.7, 0], [1, 0.3], [1, 0.7], [0.7, 1], [0.3, 1], [0, 0.7], [0, 0.3]]),
  star: star(5, 0.4),
  heart: 'M0.5 1C0.12 0.72 0 0.52 0 0.3C0 0.12 0.13 0 0.28 0C0.38 0 0.46 0.05 0.5 0.15C0.54 0.05 0.62 0 0.72 0C0.87 0 1 0.12 1 0.3C1 0.52 0.88 0.72 0.5 1z',
  arrow: poly([[0, 0.3], [0.6, 0.3], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.7], [0, 0.7]]),
  cross: poly([[0.35, 0], [0.65, 0], [0.65, 0.35], [1, 0.35], [1, 0.65], [0.65, 0.65], [0.65, 1], [0.35, 1], [0.35, 0.65], [0, 0.65], [0, 0.35], [0.35, 0.35]]),
  blob: 'M0.78 0.08C0.95 0.22 1 0.52 0.88 0.76C0.76 1 0.42 1 0.2 0.86C0 0.72 0 0.42 0.12 0.22C0.26 0 0.6 -0.05 0.78 0.08z',
  ring: 'M0.5 0A0.5 0.5 0 1 1 0.5 1A0.5 0.5 0 1 1 0.5 0z',
  line: 'M0 0H1V1H0z',
  parallelogram: poly([[0.2, 0], [1, 0], [0.8, 1], [0, 1]]),
  trapezoid: poly([[0.2, 0], [0.8, 0], [1, 1], [0, 1]]),
};

export const SHAPE_LIST = [
  ['rect', 'Retângulo'], ['circle', 'Círculo'], ['triangle', 'Triângulo'], ['diamond', 'Losango'], ['pentagon', 'Pentágono'], ['hexagon', 'Hexágono'],
  ['octagon', 'Octógono'], ['star', 'Estrela'], ['heart', 'Coração'], ['arrow', 'Seta'], ['cross', 'Cruz'], ['blob', 'Orgânica'],
  ['ring', 'Anel'], ['parallelogram', 'Paralelogramo'], ['trapezoid', 'Trapézio'], ['line', 'Linha'],
];

// Máscaras de imagem (além de "nenhuma" e "arredondada", que usam border-radius).
export const MASK_LIST = [['none', 'Nenhuma'], ['rounded', 'Arredondada'], ['circle', 'Círculo'], ['hexagon', 'Hexágono'], ['diamond', 'Losango'], ['triangle', 'Triângulo'], ['star', 'Estrela'], ['heart', 'Coração'], ['blob', 'Orgânica']];

// Caminhos que viram <clipPath> (unidades da caixa do elemento). "rect", "line" e "ring" não precisam de recorte.
export const CLIP_IDS = Object.keys(SHAPE_PATHS).filter((k) => !['rect', 'line', 'ring'].includes(k));
export const clipId = (shape, scope = 'pf') => `${scope}-clip-${shape}`;
