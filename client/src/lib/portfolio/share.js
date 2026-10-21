// Copiar e compartilhar o link da página.

// Copia para a área de transferência. Usa a API moderna e, se o navegador bloquear (http, iframe, celular antigo),
// cai num campo de texto temporário. Devolve true se copiou.
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* tenta o método antigo */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export const whatsappShareUrl = (name, url) => `https://wa.me/?text=${encodeURIComponent(`${name}\n${url}`)}`;
export const emailShareUrl = (name, url) => `mailto:?subject=${encodeURIComponent(name)}&body=${encodeURIComponent(`${name}\n${url}`)}`;
export const canNativeShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';
