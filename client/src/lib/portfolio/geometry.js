// Geometria do editor livre (código puro, testável): ajuste magnético, redimensionar com rotação e ângulos.
// Todas as medidas estão em pixels do "projeto" do dispositivo (1200, 768 ou 375 de largura), não da tela.

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const rad = (deg) => (deg * Math.PI) / 180;
export const round1 = (n) => Math.round(n * 10) / 10;

// Linhas de alinhamento: bordas e centros da página e dos outros elementos.
export function guideLines(others, W, H) {
  const xs = [0, W / 2, W];
  const ys = [0, H / 2, H];
  for (const o of others) {
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  return { xs, ys };
}

function snapAxis(start, size, lines, threshold) {
  const edges = [start, start + size / 2, start + size];
  let best = null;
  for (const e of edges) {
    for (const l of lines) {
      const d = l - e;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  if (best === null) return { pos: start, guides: [] };
  const pos = start + best;
  const next = [pos, pos + size / 2, pos + size];
  return { pos, guides: [...new Set(lines.filter((l) => next.some((e) => Math.abs(e - l) < 0.5)).map((l) => round1(l)))] };
}

// Posição final do elemento arrastado, "grudando" nas linhas próximas. `threshold` em px do projeto.
export function snapMove(box, others, W, H, threshold = 6) {
  const { xs, ys } = guideLines(others, W, H);
  const sx = snapAxis(box.x, box.w, xs, threshold);
  const sy = snapAxis(box.y, box.h, ys, threshold);
  return { x: sx.pos, y: sy.pos, guides: { x: sx.guides, y: sy.guides } };
}

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

// Redimensiona pelo ponteiro `handle` (nw, n, ne, e, se, s, sw, w) com deslocamento (dx, dy) do ponteiro, já na escala do projeto.
// Respeita a rotação: o canto oposto fica parado na tela. `keepRatio`: mantém a proporção (cantos).
export function resizeBox(start, handle, dx, dy, { keepRatio = false, minW = 8, minH = 8, centered = false } = {}) {
  const r = rad(start.r || 0);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // deslocamento do ponteiro nos eixos do próprio elemento
  const du = dx * cos + dy * sin;
  const dv = -dx * sin + dy * cos;
  const hasE = handle.includes('e');
  const hasW = handle.includes('w');
  const hasS = handle.includes('s');
  const hasN = handle.includes('n');
  const k = centered ? 2 : 1;

  let w = start.w + (hasE ? du * k : hasW ? -du * k : 0);
  let h = start.h + (hasS ? dv * k : hasN ? -dv * k : 0);

  if (keepRatio && (hasE || hasW) && (hasS || hasN)) {
    const ratio = start.w / start.h;
    if (Math.abs(w - start.w) / start.w >= Math.abs(h - start.h) / start.h) h = w / ratio;
    else w = h * ratio;
  } else if (keepRatio && (hasE || hasW)) h = w * (start.h / start.w);
  else if (keepRatio && (hasS || hasN)) w = h * (start.w / start.h);

  if (w < minW) { w = minW; }
  if (h < minH) { h = minH; }
  // o centro anda metade do que a borda andou, no eixo da alça (e = +, w = -)
  const cu = centered ? 0 : hasE ? (w - start.w) / 2 : hasW ? -(w - start.w) / 2 : 0;
  const cv = centered ? 0 : hasS ? (h - start.h) / 2 : hasN ? -(h - start.h) / 2 : 0;
  const cx = start.x + start.w / 2 + cu * cos - cv * sin;
  const cy = start.y + start.h / 2 + cu * sin + cv * cos;
  return { ...start, x: round1(cx - w / 2), y: round1(cy - h / 2), w: round1(w), h: round1(h) };
}

// Ângulo (graus) do centro do elemento até o ponteiro; 0 = para cima. `snap`: arredonda de 15 em 15.
export function angleTo(center, pointer, snap = false) {
  let a = (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90;
  a = ((a + 540) % 360) - 180;
  if (snap) a = Math.round(a / 15) * 15;
  return Math.round(a);
}

// Mede onde termina o conteúdo (para a altura mínima da página).
export function bottomOf(boxes) {
  let b = 0;
  for (const x of boxes) {
    if (x.hide) continue;
    const r = rad(x.r || 0);
    const hh = Math.abs(x.w * Math.sin(r)) + Math.abs(x.h * Math.cos(r)); // altura da caixa girada
    b = Math.max(b, x.y + x.h / 2 + hh / 2);
  }
  return Math.ceil(b);
}
