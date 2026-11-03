import sanitizeHtml from 'sanitize-html';
import * as csstree from 'css-tree';
import { AppError } from './helpers.js';

const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_CSS_BYTES = 1024 * 1024;
const FORBIDDEN_PROPERTIES = new Set(['behavior', '-moz-binding', 'binding']);
const SAFE_SCHEMES = ['http', 'https', 'mailto', 'tel'];

export function cleanPortfolioCss(value) {
  const css = typeof value === 'string' ? value : '';
  if (Buffer.byteLength(css) > MAX_CSS_BYTES) throw new AppError(413, 'O CSS da página ultrapassa o limite permitido.');
  if (!css.trim()) return '';
  let ast;
  try {
    ast = csstree.parse(css, { parseValue: true, parseRulePrelude: true });
  } catch {
    throw new AppError(400, 'O CSS contém uma regra inválida. Corrija o estilo antes de salvar.');
  }
  csstree.walk(ast, function walk(node, item, list) {
    if (node.type === 'Atrule' && !['media', 'supports', 'keyframes', '-webkit-keyframes'].includes(node.name.toLowerCase())) {
      list.remove(item);
      return;
    }
    if (node.type !== 'Declaration') return;
    if (FORBIDDEN_PROPERTIES.has(node.property.toLowerCase())) {
      list.remove(item);
      return;
    }
    let unsafe = false;
    csstree.walk(node.value, (valueNode) => {
      if (valueNode.type === 'Url' || (valueNode.type === 'Function' && ['url', 'expression'].includes(valueNode.name.toLowerCase()))) unsafe = true;
    });
    if (unsafe || /javascript|vbscript|expression\s*\(/i.test(csstree.generate(node.value))) list.remove(item);
  });
  return csstree.generate(ast);
}

function cleanInlineCss(value) {
  if (typeof value !== 'string' || value.length > 5000) return '';
  try {
    const ast = csstree.parse(`.inline{${value}}`);
    csstree.walk(ast, function walk(node, item, list) {
      if (node.type === 'Declaration') {
        let unsafe = FORBIDDEN_PROPERTIES.has(node.property.toLowerCase());
        csstree.walk(node.value, (valueNode) => {
          if (valueNode.type === 'Url' || (valueNode.type === 'Function' && ['url', 'expression'].includes(valueNode.name.toLowerCase()))) unsafe = true;
        });
        if (unsafe || /javascript|vbscript|expression\s*\(/i.test(csstree.generate(node.value))) list.remove(item);
      }
    });
    const rule = ast.children.first();
    return rule?.block ? csstree.generate(rule.block) : '';
  } catch {
    return '';
  }
}

export function cleanPortfolioHtml(value) {
  const html = typeof value === 'string' ? value : '';
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new AppError(413, 'O HTML da página ultrapassa o limite permitido.');
  return sanitizeHtml(html, {
    allowedTags: [
      'a', 'abbr', 'address', 'article', 'aside', 'b', 'blockquote', 'br', 'button', 'caption', 'code', 'dd', 'del',
      'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'header', 'hr', 'i', 'img', 'input', 'label', 'li', 'main', 'nav', 'ol', 'option', 'p', 'picture', 'pre',
      'section', 'select', 'small', 'source', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
      'textarea', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'video',
    ],
    allowedAttributes: {
      '*': ['class', 'id', 'title', 'role', 'style', 'aria-label', 'aria-hidden', 'aria-expanded', 'data-gjs-type'],
      a: ['href', 'target', 'rel'],
      button: ['type', 'disabled'],
      img: ['src', 'alt', 'width', 'height', 'loading'],
      input: ['type', 'name', 'value', 'placeholder', 'required', 'checked'],
      label: ['for'],
      option: ['value', 'selected'],
      select: ['name', 'required'],
      source: ['src', 'type'],
      video: ['controls', 'poster', 'muted', 'loop', 'playsinline'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
      textarea: ['name', 'placeholder', 'rows', 'required'],
    },
    allowedSchemes: SAFE_SCHEMES,
    allowedSchemesByTag: { img: ['http', 'https', 'data'], source: ['http', 'https', 'data'] },
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
    allowProtocolRelative: false,
    allowedStyles: {},
    transformTags: {
      '*': (tagName, attribs) => {
        if (attribs.style) {
          const style = cleanInlineCss(attribs.style);
          if (style) attribs.style = style;
          else delete attribs.style;
        }
        return { tagName, attribs };
      },
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          ...(attribs.target === '_blank' ? { rel: 'noopener noreferrer' } : {}),
        },
      }),
    },
  });
}

export function cleanGrapesPortfolio(raw, kind) {
  if (kind === 'catalog') throw new AppError(400, 'O editor de blocos é compatível com páginas de site. Use o editor de catálogo para manter os pedidos ativos.');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError(400, 'Documento do editor de blocos inválido.');
  const html = cleanPortfolioHtml(raw.html);
  const css = cleanPortfolioCss(raw.css);
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 120) : '';
  const description = typeof raw.description === 'string' ? raw.description.trim().slice(0, 300) : '';
  const doc = { v: 3, editor: 'grapesjs', title, description, html, css };
  if (Buffer.byteLength(JSON.stringify(doc)) > 20 * 1024 * 1024) {
    throw new AppError(413, 'A página ficou grande demais para salvar. Reduza as imagens ou remova alguns blocos.');
  }
  return doc;
}
