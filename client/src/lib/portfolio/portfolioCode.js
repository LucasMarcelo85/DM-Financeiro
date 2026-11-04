import { cleanGrapesCss } from './grapesCss.js';
import { cleanGrapesHtml } from './grapesPreview.js';

function protectHtml(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
}

export function preparePortfolioCode(code = {}) {
  return {
    html: cleanGrapesHtml(protectHtml(code.html || '')),
    css: cleanGrapesCss(code.css || ''),
    script: typeof code.script === 'string' ? code.script : '',
  };
}
