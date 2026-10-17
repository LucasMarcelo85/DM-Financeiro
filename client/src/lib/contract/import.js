// Importação de modelos de contrato: .docx (Word), .html, .txt/.md, .json (exportado daqui) e imagem.
// Tudo roda no navegador, sem bibliotecas: o .docx é um ZIP com XML dentro.
// O arquivo vira "blocos" (parágrafos com estilo, imagens...) e o layout.js distribui nas páginas.
import { MARGIN, normalizeDoc, pageSize, newElement, blankPage } from './model.js';
import { fitImage } from './image.js';
import { layoutBlocks } from './layout.js';

const MAX_FILE = 25 * 1024 * 1024;
const MAX_XML = 40 * 1024 * 1024;

export const IMPORT_ACCEPT = '.docx,.html,.htm,.txt,.md,.json,image/png,image/jpeg,image/webp,image/gif';

const PDF_MSG =
  'Arquivo PDF não dá para editar: ele guarda só a posição de cada letra. Abra o PDF no Word ou no Google Docs, salve como .docx e importe aqui. Se preferir, importe uma foto/imagem da página e escreva por cima.';
const OLD_MSG = 'Este formato antigo não é lido. Abra o arquivo no Word (ou Google Docs) e salve como .docx para importar.';

// ---------------------------------------------------------------- utilidades
const PT = 96 / 72;
const clampN = (n, a, b) => Math.min(b, Math.max(a, n));

export function mapFont(name) {
  const n = String(name || '').toLowerCase().replace(/["']/g, '');
  const has = (...w) => w.some((x) => n.includes(x));
  if (has('times')) return 'times';
  if (has('arial', 'helvetica')) return 'arial';
  if (has('georgia')) return 'georgia';
  if (has('verdana', 'tahoma')) return 'verdana';
  if (has('courier', 'consolas', 'mono')) return 'courier';
  if (has('garamond')) return 'garamond';
  if (has('playfair')) return 'playfair';
  if (has('merriweather')) return 'merriweather';
  if (has('lora')) return 'lora';
  if (has('montserrat')) return 'montserrat';
  if (has('poppins')) return 'poppins';
  if (has('roboto')) return 'roboto';
  if (has('open sans')) return 'opensans';
  if (has('lato')) return 'lato';
  if (has('oswald')) return 'oswald';
  if (has('dancing')) return 'dancing';
  if (has('great vibes')) return 'greatvibes';
  if (has('cambria', 'palatino', 'book antiqua', 'baskerville', 'serif') && !has('sans')) return 'georgia';
  return 'inter';
}

const hex = (c) => {
  const s = String(c || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
  if (m) return `#${[m[1], m[2], m[3]].map((v) => clampN(Number(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
  return null;
};

// Junta o formato de vários trechos do mesmo parágrafo no formato "dominante" (por quantidade de letras).
export function summarizeRuns(runs, fallback = {}) {
  const total = runs.reduce((n, r) => n + r.text.length, 0) || 1;
  const frac = (key) => runs.reduce((n, r) => n + (r.fmt?.[key] ? r.text.length : 0), 0) / total;
  const mode = (key) => {
    const w = new Map();
    for (const r of runs) {
      const v = r.fmt?.[key];
      if (v != null && v !== '') w.set(v, (w.get(v) || 0) + r.text.length);
    }
    return [...w.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  return {
    bold: frac('bold') > 0.5,
    italic: frac('italic') > 0.5,
    underline: frac('underline') > 0.5,
    fontSize: mode('size') ?? fallback.fontSize,
    color: mode('color') ?? fallback.color,
    font: mode('font') ?? fallback.font,
  };
}

function styleFor(sum, { align, lineHeight, defaults = {} }) {
  const out = {
    fontFamily: mapFont(sum.font ?? defaults.font),
    fontSize: Math.round(clampN(sum.fontSize ?? defaults.fontSize ?? 14, 8, 72)),
    bold: sum.bold, italic: sum.italic, underline: sum.underline,
    align: align || 'left',
    lineHeight: clampN(lineHeight ?? 1.5, 1, 2.5),
  };
  const color = hex(sum.color ?? defaults.color);
  if (color && color !== '#000000') out.color = color; // preto do Word vira o preto-azulado padrão
  return out;
}

// ---------------------------------------------------------------- ZIP (para .docx)
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Seu navegador é antigo demais para ler .docx. Atualize o navegador.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function openZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Este arquivo não parece ser um documento do Word (.docx).');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014b50) break;
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    entries.set(dec.decode(buf.subarray(p + 46, p + 46 + nameLen)), {
      method: dv.getUint16(p + 10, true), comp: dv.getUint32(p + 20, true), size: dv.getUint32(p + 24, true), offset: dv.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    has: (name) => entries.has(name),
    async read(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (e.size > MAX_XML) throw new Error('O documento é grande demais para importar.');
      const o = e.offset;
      if (dv.getUint32(o, true) !== 0x04034b50) throw new Error('Arquivo .docx danificado.');
      const start = o + 30 + dv.getUint16(o + 26, true) + dv.getUint16(o + 28, true);
      const data = buf.subarray(start, start + e.comp);
      if (e.method === 0) return data;
      if (e.method === 8) return inflateRaw(data);
      throw new Error('Arquivo .docx com compressão não suportada.');
    },
    async text(name) {
      const b = await this.read(name);
      return b ? new TextDecoder('utf-8').decode(b) : null;
    },
  };
}

// ---------------------------------------------------------------- XML do Word
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'urn:schemas-microsoft-com:vml';

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Não foi possível ler o conteúdo do documento.');
  return doc;
}
const kids = (el, ns, local) => (el ? [...el.childNodes].filter((n) => n.nodeType === 1 && n.namespaceURI === ns && n.localName === local) : []);
const kid = (el, ns, local) => kids(el, ns, local)[0] || null;
const wval = (el) => (el ? el.getAttributeNS(W, 'val') ?? el.getAttribute('w:val') : null);
const isOff = (v) => v === 'false' || v === '0' || v === 'none' || v === 'off';

function readRPr(rPr) {
  const r = {};
  if (!rPr) return r;
  const flag = (name) => { const e = kid(rPr, W, name); if (e) return !isOff(wval(e)); return undefined; };
  const b = flag('b'); if (b !== undefined) r.bold = b;
  const i = flag('i'); if (i !== undefined) r.italic = i;
  const caps = flag('caps'); if (caps !== undefined) r.caps = caps;
  const u = kid(rPr, W, 'u'); if (u) r.underline = !isOff(wval(u) || 'single');
  const sz = kid(rPr, W, 'sz'); if (sz && Number(wval(sz))) r.size = (Number(wval(sz)) / 2) * PT;
  const color = kid(rPr, W, 'color'); if (color && wval(color) && wval(color) !== 'auto') r.color = wval(color);
  const fonts = kid(rPr, W, 'rFonts');
  if (fonts) {
    const f = fonts.getAttributeNS(W, 'ascii') || fonts.getAttributeNS(W, 'hAnsi') || fonts.getAttribute('w:ascii') || fonts.getAttribute('w:hAnsi');
    if (f) r.font = f;
  }
  return r;
}

function readPPr(pPr) {
  const p = { r: readRPr(kid(pPr, W, 'rPr')) };
  if (!pPr) return p;
  const jc = wval(kid(pPr, W, 'jc'));
  if (jc) p.jc = jc === 'both' || jc === 'distribute' ? 'justify' : jc === 'start' ? 'left' : jc === 'end' ? 'right' : jc;
  const sp = kid(pPr, W, 'spacing');
  if (sp) {
    const after = sp.getAttributeNS(W, 'after') ?? sp.getAttribute('w:after');
    const line = sp.getAttributeNS(W, 'line') ?? sp.getAttribute('w:line');
    const rule = sp.getAttributeNS(W, 'lineRule') ?? sp.getAttribute('w:lineRule');
    if (after != null && after !== '') p.after = Number(after) / 15;
    if (line && (!rule || rule === 'auto') && Number(line)) p.lineHeight = Number(line) / 240;
  }
  const ind = kid(pPr, W, 'ind');
  if (ind) {
    const left = ind.getAttributeNS(W, 'left') ?? ind.getAttribute('w:left') ?? ind.getAttributeNS(W, 'start');
    if (left) p.indent = Number(left) / 15;
  }
  const numPr = kid(pPr, W, 'numPr');
  if (numPr) {
    p.numId = wval(kid(numPr, W, 'numId'));
    p.ilvl = Number(wval(kid(numPr, W, 'ilvl')) || 0);
  }
  const ps = kid(pPr, W, 'pStyle'); if (ps) p.styleId = wval(ps);
  if (kid(pPr, W, 'pageBreakBefore')) p.pageBreakBefore = true;
  return p;
}

function parseStyles(xml) {
  const styles = new Map();
  let defaults = {};
  if (!xml) return { styles, defaults };
  const doc = parseXml(xml);
  const dd = doc.getElementsByTagNameNS(W, 'docDefaults')[0];
  if (dd) defaults = readRPr(kid(kid(dd, W, 'rPrDefault'), W, 'rPr'));
  for (const s of doc.getElementsByTagNameNS(W, 'style')) {
    const id = s.getAttributeNS(W, 'styleId') ?? s.getAttribute('w:styleId');
    if (!id) continue;
    const pp = readPPr(kid(s, W, 'pPr'));
    pp.r = { ...pp.r, ...readRPr(kid(s, W, 'rPr')) };
    styles.set(id, { name: String(wval(kid(s, W, 'name')) || '').toLowerCase(), basedOn: wval(kid(s, W, 'basedOn')), p: pp });
  }
  return { styles, defaults };
}

function resolveStyle(styles, id) {
  const chain = [];
  const seen = new Set();
  for (let cur = id; cur && styles.has(cur) && !seen.has(cur) && chain.length < 12; cur = styles.get(cur).basedOn) {
    seen.add(cur);
    chain.unshift(styles.get(cur));
  }
  const out = { r: {}, name: chain.at(-1)?.name || '' };
  for (const s of chain) Object.assign(out, { ...s.p, r: { ...out.r, ...s.p.r } });
  return out;
}

function parseNumbering(xml) {
  const abs = new Map();
  const nums = new Map();
  if (!xml) return { abs, nums };
  const doc = parseXml(xml);
  for (const a of doc.getElementsByTagNameNS(W, 'abstractNum')) {
    const id = a.getAttributeNS(W, 'abstractNumId') ?? a.getAttribute('w:abstractNumId');
    const levels = [];
    for (const l of kids(a, W, 'lvl')) {
      levels[Number(l.getAttributeNS(W, 'ilvl') ?? l.getAttribute('w:ilvl') ?? 0)] = {
        fmt: wval(kid(l, W, 'numFmt')) || 'decimal', text: wval(kid(l, W, 'lvlText')) || '', start: Number(wval(kid(l, W, 'start')) || 1),
      };
    }
    abs.set(id, levels);
  }
  for (const n of doc.getElementsByTagNameNS(W, 'num')) {
    const id = n.getAttributeNS(W, 'numId') ?? n.getAttribute('w:numId');
    nums.set(id, wval(kid(n, W, 'abstractNumId')));
  }
  return { abs, nums };
}

const roman = (n) => {
  const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return s;
};
function fmtNumber(n, fmt) {
  if (fmt === 'lowerLetter' || fmt === 'upperLetter') {
    const s = String.fromCharCode(97 + ((n - 1) % 26));
    return fmt === 'upperLetter' ? s.toUpperCase() : s;
  }
  if (fmt === 'lowerRoman') return roman(n);
  if (fmt === 'upperRoman') return roman(n).toUpperCase();
  return String(n);
}

function listPrefix(num, numId, ilvl) {
  const levels = num.abs.get(num.nums.get(numId));
  const lvl = levels?.[ilvl];
  if (!lvl || lvl.fmt === 'bullet' || lvl.fmt === 'none') return ilvl > 0 ? '–' : '•';
  const counters = (num.counters ||= new Map()).get(numId) || [];
  counters[ilvl] = (counters[ilvl] ?? lvl.start - 1) + 1;
  counters.length = ilvl + 1;
  num.counters.set(numId, counters);
  const text = lvl.text || `%${ilvl + 1}.`;
  return text.replace(/%(\d)/g, (_, d) => {
    const li = Number(d) - 1;
    return fmtNumber(counters[li] ?? levels[li]?.start ?? 1, levels[li]?.fmt || 'decimal');
  });
}

function resolvePath(base, target) {
  const parts = (target.startsWith('/') ? target.slice(1) : `${base}${target}`).split('/');
  const out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
  return out.join('/');
}
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

async function docxToBlocks(file, notes) {
  const zip = await openZip(file);
  const docXml = await zip.text('word/document.xml');
  if (!docXml) throw new Error('Este arquivo não parece ser um documento do Word (.docx).');
  const xml = parseXml(docXml);
  const { styles, defaults } = parseStyles(await zip.text('word/styles.xml'));
  const num = parseNumbering(await zip.text('word/numbering.xml'));
  const rels = new Map();
  const relsXml = await zip.text('word/_rels/document.xml.rels');
  if (relsXml) {
    for (const r of parseXml(relsXml).getElementsByTagName('Relationship')) {
      rels.set(r.getAttribute('Id'), { type: r.getAttribute('Type') || '', target: r.getAttribute('Target') || '', mode: r.getAttribute('TargetMode') });
    }
  }

  const baseSize = defaults.size ?? 11 * PT;
  const blocks = [];
  let skippedImages = 0;
  let sawTable = false;

  async function imageFor(rid, extentPx) {
    const rel = rels.get(rid);
    if (!rel || rel.mode === 'External') { skippedImages++; return null; }
    const path = resolvePath('word/', rel.target);
    const mime = MIME[path.split('.').pop().toLowerCase()];
    const bytes = mime && zip.has(path) ? await zip.read(path) : null;
    if (!bytes) { skippedImages++; return null; }
    try {
      const img = await fitImage(new Blob([bytes], { type: mime }));
      const ratio = img.w / img.h;
      const w = extentPx?.w || img.w;
      const h = extentPx?.w && extentPx?.h ? extentPx.h : Math.round(w / ratio);
      return { kind: 'img', src: img.src, w, h };
    } catch {
      skippedImages++;
      return null;
    }
  }

  async function paragraph(p) {
    const pp = readPPr(kid(p, W, 'pPr'));
    const st = resolveStyle(styles, pp.styleId);
    const para = { ...st, ...Object.fromEntries(Object.entries(pp).filter(([k, v]) => v !== undefined && k !== 'r')) };
    const paraR = { ...defaults, ...st.r };
    const extra = []; // blocos que vêm depois (caixas de texto)
    const out = [];
    let runs = [];
    let hadContent = false;

    const flush = () => {
      if (!runs.length) return;
      let text = runs.map((r) => (r.fmt.caps ? r.text.toUpperCase() : r.text)).join('').replace(/[ \t]+$/g, '').replace(/^\n+/, '');
      const rs = runs;
      runs = [];
      if (!text.trim()) return;
      hadContent = true;
      const sum = summarizeRuns(rs.map((r) => ({ text: r.text, fmt: { bold: r.fmt.bold, italic: r.fmt.italic, underline: r.fmt.underline, size: r.fmt.size, color: r.fmt.color, font: r.fmt.font } })), {});
      const name = st.name;
      const heading = /^(title|heading 1)$/.test(name) ? 'title' : /^(subtitle|heading [2-9])$/.test(name) ? 'subtitle' : 'text';
      let indent = 0;
      if (para.numId && para.numId !== '0') {
        // A numeração pode vir do próprio parágrafo ou do estilo dele (ex.: "List Bullet").
        const prefix = listPrefix(num, para.numId, para.ilvl || 0);
        text = `${prefix}  ${text}`;
        indent = 16 + (para.ilvl || 0) * 22;
      } else if (para.indent) indent = clampN(para.indent, 0, 240);
      out.push({
        kind: 'text', t: heading, text, indent,
        gapAfter: clampN(para.after ?? 8, 0, 40),
        style: styleFor(sum, { align: para.jc, lineHeight: para.lineHeight, defaults: { fontSize: baseSize, font: defaults.font, color: defaults.color } }),
      });
    };

    const handleRun = async (r) => {
      const style = { ...paraR, ...(kid(kid(r, W, 'rPr'), W, 'rStyle') ? resolveStyle(styles, wval(kid(kid(r, W, 'rPr'), W, 'rStyle'))).r : {}), ...readRPr(kid(r, W, 'rPr')) };
      const fmt = { bold: !!style.bold, italic: !!style.italic, underline: !!style.underline, caps: !!style.caps, size: style.size ?? baseSize, color: style.color, font: style.font };
      let buf = '';
      const commit = () => { if (buf) { runs.push({ text: buf, fmt }); buf = ''; } };
      const children = async (parent) => {
        for (const c of parent.childNodes) {
          if (c.nodeType !== 1) continue;
          const local = c.localName;
          if (local === 'AlternateContent' && c.namespaceURI === MC) {
            // Só a versão moderna (Choice): a "Fallback" repete o mesmo conteúdo.
            const choice = [...c.childNodes].find((n) => n.nodeType === 1 && n.localName === 'Choice');
            if (choice) await children(choice);
          } else if (local === 'drawing' || local === 'pict' || local === 'object') {
            commit();
            const blip = c.getElementsByTagNameNS(A, 'blip')[0];
            const vml = c.getElementsByTagNameNS(V, 'imagedata')[0];
            const rid = blip?.getAttributeNS(R, 'embed') || vml?.getAttributeNS(R, 'id') || vml?.getAttribute('r:id');
            for (const tx of c.getElementsByTagNameNS(W, 'txbxContent')) for (const q of kids(tx, W, 'p')) extra.push(q);
            if (rid) {
              flush();
              const ext = c.getElementsByTagNameNS(WP, 'extent')[0];
              const extentPx = ext ? { w: Number(ext.getAttribute('cx')) / 9525, h: Number(ext.getAttribute('cy')) / 9525 } : null;
              const im = await imageFor(rid, extentPx);
              if (im) { hadContent = true; out.push(im); }
            }
          } else if (c.namespaceURI === W) {
            switch (local) {
              case 't': buf += c.textContent; break;
              case 'tab': buf += '    '; break;
              case 'noBreakHyphen': buf += '-'; break;
              case 'cr': buf += '\n'; break;
              case 'br':
                if ((c.getAttributeNS(W, 'type') ?? c.getAttribute('w:type')) === 'page') { commit(); flush(); out.push({ kind: 'pagebreak' }); } else buf += '\n';
                break;
              default: break;
            }
          }
        }
      };
      await children(r);
      commit();
    };

    const walk = async (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType !== 1) continue;
        if (c.namespaceURI === W) {
          if (c.localName === 'r') await handleRun(c);
          else if (['hyperlink', 'ins', 'smartTag', 'fldSimple', 'sdt', 'sdtContent', 'customXml'].includes(c.localName)) await walk(c);
        } else if (c.namespaceURI === MC && c.localName === 'AlternateContent') {
          const choice = [...c.childNodes].find((n) => n.nodeType === 1 && n.localName === 'Choice');
          if (choice) await walk(choice);
        }
      }
    };
    await walk(p);
    flush();

    const hasPageBreak = out.some((b) => b.kind === 'pagebreak');
    if (!hadContent && !hasPageBreak) {
      const h = Math.round((paraR.size ?? baseSize) * 0.9);
      out.push({ kind: 'space', h: clampN(h, 4, 40), empty: true });
    }
    if (pp.pageBreakBefore) out.unshift({ kind: 'pagebreak' });
    blocks.push(...out);
    for (const q of extra) await paragraph(q);
  }

  async function table(tbl) {
    sawTable = true;
    for (const tr of kids(tbl, W, 'tr')) {
      const cells = kids(tr, W, 'tc').map((tc) => kids(tc, W, 'p').map((q) => [...q.getElementsByTagNameNS(W, 't')].map((t) => t.textContent).join('')).filter(Boolean).join(' '));
      if (!cells.some(Boolean)) continue;
      blocks.push({ kind: 'text', t: 'text', text: cells.join('   |   '), gapAfter: 4, style: { fontSize: Math.round(baseSize), align: 'left', lineHeight: 1.4 } });
    }
  }

  async function container(node) {
    for (const c of node.childNodes) {
      if (c.nodeType !== 1 || c.namespaceURI !== W) continue;
      if (c.localName === 'p') await paragraph(c);
      else if (c.localName === 'tbl') await table(c);
      else if (c.localName === 'sdt') await container(kid(c, W, 'sdtContent') || c);
    }
  }
  await container(xml.getElementsByTagNameNS(W, 'body')[0]);

  // Parágrafos vazios seguidos viram no máximo 3 espaços.
  const cleaned = [];
  let empties = 0;
  for (const b of blocks) {
    if (b.kind === 'space' && b.empty) { if (++empties > 3) continue; } else empties = 0;
    cleaned.push(b);
  }
  while (cleaned.length && (cleaned[0].kind === 'space' || cleaned[0].kind === 'pagebreak')) cleaned.shift();
  while (cleaned.length && cleaned.at(-1).kind === 'space') cleaned.pop();

  if (sawTable) notes.push('As tabelas do Word viraram uma linha de texto por linha da tabela.');
  if (skippedImages) notes.push(`${skippedImages} imagem(ns) em formato não suportado foram ignoradas.`);
  notes.push('Cabeçalhos, rodapés e formatações dentro de uma mesma frase (como uma palavra em negrito) não são importados: ajuste no editor.');
  return cleaned;
}

// ---------------------------------------------------------------- HTML
const BLOCK_TAGS = new Set('address article aside blockquote details div dl fieldset figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table tr ul'.split(' '));
const HEADINGS = { h1: { size: 28, t: 'title' }, h2: { size: 22, t: 'subtitle' }, h3: { size: 18, t: 'subtitle' }, h4: { size: 16, t: 'subtitle' }, h5: { size: 15, t: 'subtitle' }, h6: { size: 14, t: 'subtitle' } };

function cssOf(el) {
  const out = {};
  for (const part of (el.getAttribute?.('style') || '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}
function cssFmt(el, fmt) {
  const css = cssOf(el);
  const next = { ...fmt };
  const tag = el.tagName?.toLowerCase();
  if (tag === 'b' || tag === 'strong' || /^h[1-6]$/.test(tag)) next.bold = true;
  if (tag === 'i' || tag === 'em') next.italic = true;
  if (tag === 'u') next.underline = true;
  const fw = css['font-weight'];
  if (fw) next.bold = fw === 'bold' || fw === 'bolder' || Number(fw) >= 600;
  if (css['font-style']) next.italic = /italic|oblique/.test(css['font-style']);
  if (css['text-decoration'] || css['text-decoration-line']) next.underline = /underline/.test(css['text-decoration'] || css['text-decoration-line']);
  const c = hex(css.color || el.getAttribute?.('color'));
  if (c) next.color = c;
  const fs = /^([\d.]+)(px|pt)$/.exec(css['font-size'] || '');
  if (fs) next.size = Number(fs[1]) * (fs[2] === 'pt' ? PT : 1);
  const ff = css['font-family'] || el.getAttribute?.('face');
  if (ff) next.font = ff.split(',')[0];
  const al = (css['text-align'] || el.getAttribute?.('align') || '').toLowerCase();
  if (['left', 'center', 'right', 'justify'].includes(al)) next.align = al;
  return next;
}

async function htmlToBlocks(html, notes) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,template,iframe,object,embed').forEach((n) => n.remove());
  const body = doc.body;
  if (!body) throw new Error('Este arquivo HTML está vazio.');
  const blocks = [];
  let skippedImages = 0;

  async function imageBlock(img) {
    const src = img.getAttribute('src') || '';
    if (!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(src)) { skippedImages++; return null; }
    try {
      const bin = atob(src.slice(src.indexOf(',') + 1));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const r = await fitImage(new Blob([bytes], { type: /^data:([^;]+)/.exec(src)[1].toLowerCase() }));
      const ar = r.w / r.h;
      const w = Number(img.getAttribute('width')) || r.w;
      const h = Number(img.getAttribute('height')) || Math.round(w / ar);
      return { kind: 'img', src: r.src, w, h };
    } catch { skippedImages++; return null; }
  }

  // Lê o conteúdo "em linha" de um elemento: devolve itens {text, fmt} e {img}.
  function inline(node, fmt, items, pre) {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) {
        const raw = c.textContent;
        const text = pre ? raw : raw.replace(/\s+/g, ' ');
        if (text) items.push({ text, fmt });
      } else if (c.nodeType === 1) {
        const tag = c.tagName.toLowerCase();
        if (tag === 'br') items.push({ text: '\n', fmt });
        else if (tag === 'img') items.push({ img: c });
        else if (!BLOCK_TAGS.has(tag)) inline(c, cssFmt(c, fmt), items, pre);
      }
    }
  }

  async function paragraphFrom(el, ctx, extra = {}) {
    const items = [];
    const fmt = cssFmt(el, ctx);
    const tag = el.tagName.toLowerCase();
    inline(el, fmt, items, tag === 'pre');
    let runs = [];
    const flush = async () => {
      let text = runs.map((r) => r.text).join('');
      const rs = runs;
      runs = [];
      text = tag === 'pre' ? text.replace(/\s+$/, '') : text.replace(/^[ \n]+|[ \n]+$/g, '').replace(/ *\n */g, '\n');
      if (!text) return;
      const sum = summarizeRuns(rs.map((r) => ({ text: r.text, fmt: { bold: r.fmt.bold, italic: r.fmt.italic, underline: r.fmt.underline, size: r.fmt.size, color: r.fmt.color, font: r.fmt.font } })));
      const h = HEADINGS[tag];
      const size = sum.fontSize ?? h?.size ?? 14;
      blocks.push({
        kind: 'text', t: h?.t || 'text', text: (extra.prefix ? `${extra.prefix}  ` : '') + text, indent: extra.indent || 0, gapAfter: h ? 12 : 8,
        style: styleFor({ ...sum, bold: sum.bold || !!h, fontSize: size }, { align: fmt.align, lineHeight: tag === 'pre' ? 1.3 : 1.5 }),
      });
    };
    for (const it of items) {
      if (it.img) { await flush(); const b = await imageBlock(it.img); if (b) blocks.push(b); } else runs.push(it);
    }
    await flush();
  }

  async function walk(node, ctx, listCtx) {
    let loose = []; // texto/inline solto dentro de um bloco "contêiner"
    const flushLoose = async () => {
      if (!loose.some((n) => (n.nodeType === 3 ? n.textContent.trim() : true))) { loose = []; return; }
      const wrap = doc.createElement('p');
      loose.forEach((n) => wrap.appendChild(n.cloneNode(true)));
      loose = [];
      await paragraphFrom(wrap, ctx, { indent: listCtx?.indent });
    };
    for (const c of node.childNodes) {
      if (c.nodeType === 3 || (c.nodeType === 1 && !BLOCK_TAGS.has(c.tagName.toLowerCase()))) { loose.push(c); continue; }
      if (c.nodeType !== 1) continue;
      await flushLoose();
      const tag = c.tagName.toLowerCase();
      const next = cssFmt(c, ctx);
      if (tag === 'hr') blocks.push({ kind: 'line', h: 1, gapAfter: 10 });
      else if (tag === 'ul' || tag === 'ol') {
        let n = Number(c.getAttribute('start') || 1);
        for (const li of c.children) {
          if (li.tagName.toLowerCase() !== 'li') {
            // HTML mal fechado pode deixar outros blocos dentro da lista: processa normalmente.
            const wrap = doc.createElement('div');
            wrap.appendChild(li.cloneNode(true));
            await walk(wrap, next, listCtx);
            continue;
          }
          const prefix = tag === 'ol' ? `${n++}.` : '•';
          const hasBlocks = [...li.children].some((x) => BLOCK_TAGS.has(x.tagName.toLowerCase()));
          if (hasBlocks) await walk(li, cssFmt(li, next), { indent: (listCtx?.indent || 0) + 22 });
          else await paragraphFrom(li, next, { prefix, indent: (listCtx?.indent || 0) + 16 });
        }
      } else if (tag === 'table') {
        for (const tr of c.querySelectorAll('tr')) {
          const cells = [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim());
          if (cells.some(Boolean)) blocks.push({ kind: 'text', t: 'text', text: cells.join('   |   '), gapAfter: 4, style: { fontSize: 13, align: 'left', lineHeight: 1.4 } });
        }
        notes.tables = true;
      } else if (['p', 'li', 'pre', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr'].includes(tag) && ![...c.children].some((x) => BLOCK_TAGS.has(x.tagName.toLowerCase()))) {
        await paragraphFrom(c, ctx, { indent: tag === 'blockquote' ? 28 : listCtx?.indent });
      } else await walk(c, next, listCtx);
    }
    await flushLoose();
  }
  await walk(body, { size: 14 }, null);
  if (notes.tables) { delete notes.tables; notes.push('As tabelas viraram uma linha de texto por linha da tabela.'); }
  if (skippedImages) notes.push(`${skippedImages} imagem(ns) que não estão embutidas no arquivo foram ignoradas.`);
  return blocks;
}

// ---------------------------------------------------------------- texto puro
function textToBlocks(text) {
  const paras = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (!paras.length) throw new Error('O arquivo está vazio.');
  const blocks = [];
  paras.forEach((p, i) => {
    if (i === 0 && p.length <= 90 && !p.includes('\n') && paras.length > 1) {
      blocks.push({ kind: 'text', t: 'title', text: p.replace(/^#+\s*/, ''), gapAfter: 16, style: { fontFamily: 'playfair', fontSize: 26, bold: true, align: 'center', lineHeight: 1.25 } });
    } else if (/^#{1,6}\s/.test(p)) {
      blocks.push({ kind: 'text', t: 'subtitle', text: p.replace(/^#+\s*/, ''), gapAfter: 10, style: { fontSize: 18, bold: true, align: 'left', lineHeight: 1.3 } });
    } else blocks.push({ kind: 'text', t: 'text', text: p, gapAfter: 10, style: { fontSize: 14, align: 'justify', lineHeight: 1.55 } });
  });
  return blocks;
}

// ---------------------------------------------------------------- entrada
const baseName = (n) => String(n || '').replace(/\.[^.]+$/, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Contrato importado';

/** Lê o arquivo e devolve { name, doc, notes }. Erros têm mensagem pronta para mostrar ao usuário. */
export async function importFile(file) {
  if (!file) throw new Error('Escolha um arquivo.');
  if (file.size > MAX_FILE) throw new Error('O arquivo é muito grande (máximo de 25 MB).');
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const name = baseName(file.name);
  const notes = [];

  if (ext === 'pdf' || file.type === 'application/pdf') throw new Error(PDF_MSG);
  if (['doc', 'rtf', 'odt', 'pages', 'wpd'].includes(ext)) throw new Error(OLD_MSG);

  if (ext === 'json') {
    let data;
    try { data = JSON.parse(await file.text()); } catch { throw new Error('Este arquivo JSON não é um modelo válido.'); }
    const raw = data?.doc ?? data;
    if (!raw || !Array.isArray(raw.pages)) throw new Error('Este arquivo JSON não é um modelo de contrato deste sistema.');
    return { name: typeof data?.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 120) : name, doc: normalizeDoc(raw), notes };
  }

  if (/^image\//.test(file.type) || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
    const img = await fitImage(file);
    const orientation = img.w > img.h ? 'landscape' : 'portrait';
    const { w, h } = pageSize(orientation);
    const page = blankPage();
    page.els.push(newElement('image', { x: 0, y: 0, w, h, src: img.src, fit: 'contain', locked: true }));
    notes.push('A imagem ficou como fundo da página (travada). Use "Destravar" se quiser movê-la e escreva por cima com os textos.');
    return { name, doc: { v: 1, orientation, pages: [page] }, notes };
  }

  let blocks;
  if (ext === 'docx') {
    try { blocks = await docxToBlocks(file, notes); } catch (e) {
      if (e.message) throw e;
      throw new Error('Não foi possível ler este .docx.');
    }
  } else if (ext === 'html' || ext === 'htm') blocks = await htmlToBlocks(await file.text(), notes);
  else if (ext === 'txt' || ext === 'md' || file.type === 'text/plain') blocks = textToBlocks(await file.text());
  else throw new Error('Formato não suportado. Envie um arquivo .docx, .html, .txt, .json (modelo exportado daqui) ou uma imagem.');

  if (!blocks.some((b) => b.kind === 'text' || b.kind === 'img')) throw new Error('Não encontrei nenhum texto neste arquivo.');
  const doc = await layoutBlocks(blocks, { margin: MARGIN });
  return { name, doc, notes };
}
