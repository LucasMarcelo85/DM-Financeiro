// Ferramentas de imagem do editor: recortar, redimensionar, remover fundo e preparar fotos de produto.
// A parte de pixels (removeBackground) é código puro, sem DOM; o resto usa <canvas> do navegador.

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

// ---------------------------------------------------------------- remover fundo
// Remove o fundo de cor uniforme (ex.: foto de produto em fundo branco/liso) a partir das bordas, como uma "varinha mágica".
//  tolerance: 0 a 100 (quanto a cor pode variar e ainda ser fundo) · feather: suaviza a borda (0 a 4)
//  seed: [r,g,b] da cor do fundo (se omitido, usa a cor mais comum nas bordas)
//  contiguous: true = só o fundo ligado às bordas (mantém o "branco" de dentro do objeto); false = tira a cor em toda a imagem.
// Altera `data` (RGBA) no lugar e devolve { bg: [r,g,b], removed: quantidade de pixels }.
export function removeBackground(data, w, h, { tolerance = 30, feather = 1, seed = null, contiguous = true } = {}) {
  const dist = (i, bg) => {
    const dr = data[i * 4] - bg[0];
    const dg = data[i * 4 + 1] - bg[1];
    const db = data[i * 4 + 2] - bg[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  // cor do fundo: a mais comum nas bordas (agrupando cores parecidas)
  let bg = seed;
  if (!bg) {
    const bins = new Map();
    const take = (i) => {
      if (data[i * 4 + 3] < 8) return;
      const key = ((data[i * 4] >> 4) << 8) | ((data[i * 4 + 1] >> 4) << 4) | (data[i * 4 + 2] >> 4);
      const b = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      b.n += 1; b.r += data[i * 4]; b.g += data[i * 4 + 1]; b.b += data[i * 4 + 2];
      bins.set(key, b);
    };
    for (let x = 0; x < w; x++) { take(x); take((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { take(y * w); take(y * w + w - 1); }
    let best = null;
    for (const b of bins.values()) if (!best || b.n > best.n) best = b;
    if (!best) return { bg: [255, 255, 255], removed: 0 };
    bg = [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
  }

  const tol = (clamp(tolerance, 0, 100) / 100) * 140 + 4; // distância de cor aceita como "fundo"
  const total = w * h;
  const gone = new Uint8Array(total);

  if (contiguous) {
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;
    const push = (i) => { if (!gone[i] && dist(i, bg) <= tol) { gone[i] = 1; queue[tail++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (i >= w) push(i - w);
      if (i < total - w) push(i + w);
    }
  } else {
    for (let i = 0; i < total; i++) if (dist(i, bg) <= tol) gone[i] = 1;
  }

  let removed = 0;
  for (let i = 0; i < total; i++) if (gone[i]) { data[i * 4 + 3] = 0; removed++; }

  // borda suave: pixels que encostam no fundo removido e ainda se parecem com o fundo ficam semitransparentes
  const rounds = clamp(Math.round(feather), 0, 4);
  if (rounds > 0 && removed) {
    const soft = tol * 0.9 + 12;
    let frontier = [];
    for (let i = 0; i < total; i++) {
      if (gone[i]) continue;
      const x = i % w;
      if ((x > 0 && gone[i - 1]) || (x < w - 1 && gone[i + 1]) || (i >= w && gone[i - w]) || (i < total - w && gone[i + w])) frontier.push(i);
    }
    for (let r = 0; r < rounds; r++) {
      const next = [];
      for (const i of frontier) {
        const d = dist(i, bg);
        if (d < tol + soft) {
          const a = clamp(((d - tol) / soft) * 255, 0, 255);
          data[i * 4 + 3] = Math.min(data[i * 4 + 3], Math.round(a));
          const x = i % w;
          for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < total - w ? i + w : -1]) {
            if (j >= 0 && !gone[j]) { gone[j] = 2; next.push(j); }
          }
        }
      }
      frontier = next;
    }
  }
  return { bg, removed };
}

// ---------------------------------------------------------------- canvas
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível abrir esta imagem.'));
    img.src = src;
  });
}

const makeCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

// Imagem -> ImageData (reduz se passar de maxDim, para a edição não pesar).
export async function readPixels(src, maxDim = 1600) {
  const img = await loadImage(src);
  const k = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const c = makeCanvas(img.naturalWidth * k, img.naturalHeight * k);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { canvas: c, ctx, w: c.width, h: c.height, image: ctx.getImageData(0, 0, c.width, c.height) };
}

// Recorte: `crop` em pixels da imagem original { x, y, w, h }. Mantém transparência (PNG) quando a imagem tem.
export async function cropImage(src, crop, { maxDim = 1600, type = 'image/png', quality = 0.9 } = {}) {
  const img = await loadImage(src);
  const sx = clamp(Math.round(crop.x), 0, img.naturalWidth - 1);
  const sy = clamp(Math.round(crop.y), 0, img.naturalHeight - 1);
  const sw = clamp(Math.round(crop.w), 1, img.naturalWidth - sx);
  const sh = clamp(Math.round(crop.h), 1, img.naturalHeight - sy);
  const k = Math.min(1, maxDim / Math.max(sw, sh));
  const c = makeCanvas(sw * k, sh * k);
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return { src: c.toDataURL(type, quality), w: c.width, h: c.height };
}

// Dimensionar: novo tamanho em pixels (mantendo ou não a proporção) — também usado para "reduzir o peso" da imagem.
export async function resizeImage(src, width, height, { type = 'image/png', quality = 0.9 } = {}) {
  const img = await loadImage(src);
  const c = makeCanvas(clamp(width, 1, 4000), clamp(height, 1, 4000));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { src: c.toDataURL(type, quality), w: c.width, h: c.height };
}

// Remove o fundo e devolve um PNG transparente. `onProgress` é opcional.
export async function removeImageBackground(src, opts = {}) {
  const px = await readPixels(src, opts.maxDim || 1600);
  const res = removeBackground(px.image.data, px.w, px.h, opts);
  px.ctx.putImageData(px.image, 0, 0);
  return { src: px.canvas.toDataURL('image/png'), w: px.w, h: px.h, ...res };
}

// Cor de um ponto da imagem (conta-gotas para escolher o fundo): x, y de 0 a 1.
export async function pickColor(src, fx, fy) {
  const px = await readPixels(src, 800);
  const x = clamp(Math.round(fx * (px.w - 1)), 0, px.w - 1);
  const y = clamp(Math.round(fy * (px.h - 1)), 0, px.h - 1);
  const i = (y * px.w + x) * 4;
  return [px.image.data[i], px.image.data[i + 1], px.image.data[i + 2]];
}

// Foto de produto: reduz para caber (lado maior até `maxDim`) e fica abaixo do limite de peso do servidor.
// Usa WebP quando o navegador cria WebP; senão JPEG (ou PNG se tiver transparência).
export async function prepareProductImage(file, { maxDim = 1000, maxBytes = 800 * 1024 } = {}) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('Use uma imagem PNG, JPG, WebP ou GIF.');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let dim = maxDim;
    for (let attempt = 0; attempt < 6; attempt++) {
      const k = Math.min(1, dim / Math.max(img.naturalWidth, img.naturalHeight));
      const c = makeCanvas(img.naturalWidth * k, img.naturalHeight * k);
      const ctx = c.getContext('2d');
      if (file.type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      for (const [type, q] of [['image/webp', 0.84], ['image/jpeg', 0.84], ['image/png', 1]]) {
        if (type === 'image/jpeg' && file.type !== 'image/jpeg' && hasAlpha(ctx, c)) continue; // JPEG apagaria a transparência
        const out = c.toDataURL(type, q);
        if (!out.startsWith(`data:${type}`)) continue; // o navegador não sabe criar esse formato
        if (Math.floor((out.length - out.indexOf(',') - 1) * 0.75) <= maxBytes) return { src: out, w: c.width, h: c.height };
      }
      dim = Math.round(dim * 0.75);
    }
    throw new Error('Não foi possível reduzir esta imagem o bastante. Tente outra.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function hasAlpha(ctx, c) {
  const d = ctx.getImageData(0, 0, Math.min(c.width, 200), Math.min(c.height, 200)).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}
