import DOMPurify from 'dompurify';

const PREVIEW_HTML_OPTIONS = {
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta', 'link'],
  FORBID_ATTR: ['srcdoc'],
  ALLOW_DATA_ATTR: true,
};

export function cleanGrapesHtml(html) {
  return DOMPurify.sanitize(html || '', PREVIEW_HTML_OPTIONS);
}

export function makeGrapesFrameDocument(html, css) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; img-src data: blob: https:; media-src data: blob: https:; style-src 'unsafe-inline'; font-src data: https:"><style>*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Arial,sans-serif}${css || ''}</style></head><body>${cleanGrapesHtml(html)}</body></html>`;
}
