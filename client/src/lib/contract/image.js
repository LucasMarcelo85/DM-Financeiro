// Leitura e compressão de imagens no navegador. As imagens ficam dentro do contrato (data URL),
// então são reduzidas aqui para o documento continuar leve (o servidor aceita até ~3 MB por imagem).

const ACCEPT = /^image\/(png|jpeg|webp|gif)$/;
const MAX_FILE = 15 * 1024 * 1024;
const TARGET_CHARS = 1_200_000; // ~900 KB de imagem
const MAX_GIF_CHARS = 2_400_000;
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,video/mp4,video/webm,.heic,.heif,.mp4,.webm';

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

  if (blob.type === 'image/gif') {
    if (original.length > MAX_GIF_CHARS) throw new Error('Este GIF é muito grande. Use um arquivo com até 1,8 MB para preservar a animação.');
    return { src: original, w: nw, h: nh };
  }

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

function waitForVideoEvent(video, eventName) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(eventName, done);
      video.removeEventListener('error', failed);
    };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('Não foi possível ler este vídeo.')); };
    video.addEventListener(eventName, done, { once: true });
    video.addEventListener('error', failed, { once: true });
  });
}

export async function videoToGif(file) {
  if (!['video/mp4', 'video/webm'].includes(file.type)) throw new Error('Use um vídeo MP4 ou WebM.');
  if (file.size > MAX_FILE) throw new Error('O vídeo é muito grande (máximo de 15 MB).');

  const { default: gifenc } = await import('gifenc');
  const { GIFEncoder, quantize, applyPalette } = gifenc;
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  const metadata = waitForVideoEvent(video, 'loadedmetadata');
  video.src = objectUrl;
  try {
    await metadata;
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 10) {
      throw new Error('O vídeo deve ter no máximo 10 segundos.');
    }

    const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Não foi possível preparar a conversão do vídeo.');
    await waitForVideoEvent(video, 'loadeddata');

    const frameCount = Math.min(40, Math.max(2, Math.ceil(video.duration * 4)));
    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      if (i > 0) {
        const seeked = waitForVideoEvent(video, 'seeked');
        video.currentTime = Math.min(video.duration - 0.01, (i * video.duration) / frameCount);
        await seeked;
      }
      context.drawImage(video, 0, 0, width, height);
      frames.push(new Uint8Array(context.getImageData(0, 0, width, height).data));
    }

    const palette = quantize(frames[0], 128, { format: 'rgb444' });
    const encoder = GIFEncoder();
    frames.forEach((frame, i) => encoder.writeFrame(applyPalette(frame, palette, 'rgb444'), width, height, {
      palette: i === 0 ? palette : undefined,
      delay: Math.round((video.duration * 1000) / frameCount),
      repeat: 0,
    }));
    encoder.finish();
    const bytes = encoder.bytes();
    if (bytes.length > 1_800_000) throw new Error('O GIF convertido ficou muito grande. Use um vídeo mais curto ou com menor resolução.');
    const src = await readAsDataURL(new Blob([bytes], { type: 'image/gif' }));
    return { src, w: width, h: height };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}
