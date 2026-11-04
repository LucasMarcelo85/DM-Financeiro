import JsBarcode from 'jsbarcode';

const ean13Check = (digits12) => {
  const sum = [...digits12].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
};

// EAN-13 interno (prefixo 2, reservado para uso da loja) com dígito verificador válido.
export function generateEan13() {
  const random = Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join('');
  const base = `2${random}`;
  return base + ean13Check(base);
}

export function barcodeFormat(code) {
  const value = String(code || '');
  if (/^\d{13}$/.test(value) && ean13Check(value.slice(0, 12)) === value[12]) return 'EAN13';
  if (/^\d{12}$/.test(value)) return 'UPC';
  if (/^\d{8}$/.test(value)) return 'EAN8';
  return 'CODE128';
}

// Devolve as barras como sequência de 0/1 (um caractere por módulo) para desenhar em SVG sem HTML injetado.
export function encodeBarcode(code) {
  const value = String(code || '').trim();
  if (!value) return null;
  const attempt = (format) => {
    const target = {};
    JsBarcode(target, value, { format, valid: () => {} });
    const bits = (target.encodings || []).map((item) => item.data).join('').replace(/^0+|0+$/g, '');
    return bits || null;
  };
  try {
    return attempt(barcodeFormat(value));
  } catch {
    try { return attempt('CODE128'); } catch { return null; }
  }
}

// Compara códigos lidos pela câmera com os cadastrados (UPC-A e EAN-13 só diferem por um zero à esquerda).
export const normalizeCode = (code) => {
  const value = String(code || '').trim().toLowerCase();
  return /^\d+$/.test(value) ? value.replace(/^0+/, '') : value;
};
export const sameCode = (a, b) => Boolean(a) && Boolean(b) && normalizeCode(a) === normalizeCode(b);
