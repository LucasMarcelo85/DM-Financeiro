// Leitura e compressão de imagens no navegador. As imagens ficam dentro do contrato (data URL),
// então são reduzidas aqui para o documento continuar leve (o servidor aceita até ~3 MB por imagem).

const ACCEPT = /^image\/(png|jpeg|webp|gif)$/;
const MAX_FILE = 15 * 1024 * 1024;
const TARGET_CHARS = 1_200_000; // ~900 KB de imagem
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

function readAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    r.readAsDataURL(blob);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível abrir esta imagem. Tente outro arquivo.'));
    img.src = src;
  });
}

// Devolve { src, w, h } (w/h = tamanho natural já reduzido).
export async function fitImage(blob, maxDim = 1600) {
  if (!ACCEPT.test(blob.type)) throw new Error('Use uma imagem PNG, JPG, WebP ou GIF.');
  if (blob.size > MAX_FILE) throw new Error('A imagem é muito grande (máximo de 15 MB).');
  const original = await readAsDataURL(blob);
  const img = await loadImage(original);
  const nw = img.naturalWidth || 1;
  const nh = img.naturalHeight || 1;

  if (Math.max(nw, nh) <= maxDim && original.length <= TARGET_CHARS) return { src: original, w: nw, h: nh };

  // PNG/WebP/GIF podem ter fundo transparente (logos): mantém PNG. Fotos (JPEG) continuam JPEG.
  const keepAlpha = blob.type !== 'image/jpeg';
  let dim = maxDim;
  for (let attempt = 0; attempt < 4; attempt++) {
    const scale = Math.min(1, dim / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!keepAlpha) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);
    let out = keepAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.86);
    // PNG grande demais (foto com transparência): troca por JPEG com fundo branco.
    if (out.length > TARGET_CHARS && keepAlpha && attempt >= 1) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      out = canvas.toDataURL('image/jpeg', 0.86);
    }
    if (out.length <= TARGET_CHARS) return { src: out, w, h };
    dim = Math.round(dim * 0.7);
  }
  throw new Error('Não foi possível reduzir esta imagem o bastante. Use uma imagem menor.');
}
