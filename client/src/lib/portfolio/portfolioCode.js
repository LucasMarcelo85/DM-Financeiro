import { cleanGrapesCss } from './grapesCss.js';
import { cleanGrapesHtml } from './grapesPreview.js';

function encodeScript(source) {
  const bytes = new TextEncoder().encode(source || '');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function protectHtml(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
}

export function makePortfolioCodeDocument(code = {}) {
  const css = cleanGrapesCss(code.css || '');
  const script = typeof code.script === 'string' ? code.script : '';
  const encoded = encodeScript(script);
  const bootstrap = encoded
    ? `<script>(()=>{try{const binary=atob('${encoded}');const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));const source=new TextDecoder().decode(bytes);const node=document.createElement('script');node.textContent=source;document.body.appendChild(node)}catch(error){console.error('Erro no script personalizado',error)}})()<\/script>`
    : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; img-src data: blob: https:; media-src data: blob: https:; style-src 'unsafe-inline'; font-src data: https:"><style>*{box-sizing:border-box}html,body{width:100%;height:100%;min-height:100%;margin:0;overflow:auto}body{font-family:Arial,sans-serif}${css}</style></head><body>${cleanGrapesHtml(protectHtml(code.html || ''))}${bootstrap}</body></html>`;
}
