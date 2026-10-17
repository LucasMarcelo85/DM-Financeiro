// Distribui blocos de conteúdo (de um arquivo importado ou de um modelo pronto) em páginas.
// A altura de cada texto é MEDIDA no navegador com o mesmo estilo usado no editor, então a divisão
// em páginas bate com o que aparece na tela.
import { MARGIN, blankPage, fontCss, newElement, pageSize, textStyle } from './model.js';

const PX_PROPS = new Set(['fontSize', 'padding', 'borderRadius', 'width', 'height', 'margin']);

function applyStyle(node, style) {
  for (const [k, v] of Object.entries(style)) node.style[k] = typeof v === 'number' && PX_PROPS.has(k) ? `${v}px` : String(v);
}

let host;
function getHost() {
  if (host && host.isConnected) return host;
  host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;';
  document.body.appendChild(host);
  return host;
}

// Altura (px) que um elemento de texto ocupa com o conteúdo `text`.
export function measureText(el, text = el.text) {
  const node = document.createElement('div');
  applyStyle(node, textStyle(el));
  node.style.width = `${el.w}px`;
  node.textContent = text.endsWith('\n') || text === '' ? `${text}\u200b` : text;
  const h = getHost();
  h.appendChild(node);
  const height = node.offsetHeight;
  h.removeChild(node);
  return height;
}

// Espera as fontes usadas carregarem (senão a medição usaria a fonte reserva e erraria as alturas).
export async function loadFonts(keys) {
  if (!document.fonts?.load) return;
  const jobs = [...new Set(keys)].flatMap((k) => [`400 16px ${fontCss(k)}`, `700 16px ${fontCss(k)}`].map((f) => document.fonts.load(f).catch(() => {})));
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 2500))]);
}

// Maior começo de `text` que cabe em `room` px de altura (null se nem uma palavra couber).
function fitPrefix(el, text, room) {
  const tokens = text.split(/(\s+)/);
  const join = (k) => tokens.slice(0, k).join('').trimEnd();
  let lo = 0;
  let hi = tokens.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const chunk = join(mid);
    if (chunk && measureText(el, chunk) <= room) lo = mid;
    else hi = mid - 1;
  }
  const head = join(lo);
  if (!head) return null;
  const rest = tokens.slice(lo).join('').trimStart();
  return { head, rest };
}

/**
 * Blocos aceitos:
 *  { kind: 'text', t: 'title'|'subtitle'|'text'|'capsule', text, style?, indent?, gapAfter?, keepTogether?, w?, center? }
 *  { kind: 'img', src, w, h, center? }   { kind: 'line', h?, color?, gapAfter? }
 *  { kind: 'space', h }   { kind: 'pagebreak' }   { kind: 'sign', labels: [a, b] }
 * Opções: orientation, margin, gap, firstPageTop (início da 1ª página), extras (elementos soltos na 1ª página).
 */
export async function layoutBlocks(blocks, { orientation = 'portrait', margin = MARGIN, gap = 10, firstPageTop, extras = [] } = {}) {
  const { w: PW, h: PH } = pageSize(orientation);
  const CW = PW - margin * 2;
  const bottom = PH - margin;
  const contentH = bottom - margin;

  await loadFonts(blocks.filter((b) => b.kind === 'text').map((b) => b.style?.fontFamily || 'inter'));

  const pages = [blankPage()];
  pages[0].els.push(...extras);
  let y = firstPageTop ?? margin;
  const cur = () => pages[pages.length - 1];
  const newPage = () => { pages.push(blankPage()); y = margin; };
  const push = (el) => cur().els.push(el);

  for (const b of blocks) {
    if (b.kind === 'pagebreak') {
      if (cur().els.length || pages.length === 1) newPage();
    } else if (b.kind === 'space') {
      y += b.h;
    } else if (b.kind === 'line') {
      const h = b.h ?? 1;
      if (y + h > bottom) newPage();
      push(newElement('line', { x: margin, y, w: CW, h, ...(b.color ? { color: b.color } : {}) }));
      y += h + (b.gapAfter ?? gap);
    } else if (b.kind === 'img') {
      const scale = Math.min(1, CW / b.w, contentH / b.h);
      const w = Math.max(8, Math.round(b.w * scale));
      const h = Math.max(8, Math.round(b.h * scale));
      if (y + h > bottom && y > margin) newPage();
      push(newElement('image', { x: b.center ? margin + (CW - w) / 2 : margin, y, w, h, src: b.src }));
      y += h + (b.gapAfter ?? gap);
    } else if (b.kind === 'sign') {
      const colW = Math.round(CW * 0.4);
      const probe = (x, text) => newElement('text', { x, y: 0, w: colW, text, fontSize: 13, align: 'center', lineHeight: 1.3 });
      const labels = b.labels.map((t, i) => probe(i === 0 ? margin : margin + CW - colW, t));
      const need = 48 + 8 + Math.max(...labels.map((l) => measureText(l)));
      if (y + need > bottom && y > margin) newPage();
      const lineY = y + 48;
      labels.forEach((l) => {
        push(newElement('line', { x: l.x, y: lineY, w: colW, h: 1, color: '#14202e' }));
        push({ ...l, y: lineY + 8 });
      });
      y += need + (b.gapAfter ?? gap);
    } else if (b.kind === 'text') {
      const indent = b.indent || 0;
      const x = b.center && b.w ? margin + (CW - b.w) / 2 : margin + indent;
      const w = b.w || CW - indent;
      const gapAfter = b.gapAfter ?? gap;
      let text = b.text;
      for (let guard = 0; guard < 400; guard++) {
        const el = newElement(b.t, { ...b.style, text, x, y, w });
        const h = measureText(el);
        const room = bottom - y;
        const lineH = el.fontSize * el.lineHeight;
        if (h <= room) { push(el); y += h + gapAfter; break; }
        const fresh = y <= margin + 0.5 || (pages.length === 1 && firstPageTop != null && y <= firstPageTop + 0.5);
        const tooTall = room < lineH * 2.2 + el.padding * 2 + el.borderWidth * 2;
        const small = h <= contentH * 0.35;
        if (!fresh && (b.keepTogether || tooTall || small)) { newPage(); continue; }
        const parts = fitPrefix(el, text, room);
        if (!parts) { push(el); y = bottom; break; } // nada cabe nem numa página nova: coloca assim mesmo
        push({ ...el, text: parts.head });
        if (!parts.rest) { y += measureText(el, parts.head) + gapAfter; break; }
        newPage();
        text = parts.rest;
      }
    }
  }

  while (pages.length > 1 && cur().els.length === 0) pages.pop();
  return { v: 1, orientation, pages };
}
