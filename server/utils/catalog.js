import { AppError, normalizePhone, onlyDigits } from './helpers.js';

// Validação (lista branca) de produtos, configuração do catálogo e pedidos. Nada além do que está aqui chega ao banco.

export const PRODUCT_KINDS = new Set(['produto', 'servico']);
export const MAX_PRODUCT_IMAGES = 4;
export const MAX_PRODUCT_PRICE_OPTIONS = 12;
export const MAX_PRODUCT_IMAGE_BYTES = 900 * 1024;
const MAX_PRICE = 10_000_000; // R$ 100.000,00

const line = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const intIn = (v, min, max, label) => {
  const n = typeof v === 'number' ? v : /^\d+$/.test(String(v ?? '').trim()) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError(400, `${label}: informe um número válido (${min} a ${max}).`);
  return n;
};
const numIn = (v, min, max, label) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw new AppError(400, `${label}: informe um número entre ${min} e ${max}.`);
  return Math.round(n * 100) / 100;
};

// ---------- Imagens (data URL de PNG/JPEG/WebP, conferidas pelo conteúdo, não só pelo texto) ----------
const MAGIC = {
  'image/png': (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};
export function decodeProductImage(src) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(typeof src === 'string' ? src : '');
  const buf = m ? Buffer.from(m[2], 'base64') : null;
  if (!buf || buf.length > MAX_PRODUCT_IMAGE_BYTES || !MAGIC[m[1]](buf)) {
    throw new AppError(400, 'Uma das imagens não é válida. Use PNG, JPG ou WebP de até 900 KB (a tela já reduz o tamanho sozinha).');
  }
  return { mime: m[1], data: buf };
}

// ---------- Produto / serviço ----------
// `images`: [{ id }] (mantém uma imagem que já existe) ou [{ data: 'data:image/...' }] (nova), com `label` (variação).
export function cleanProduct(b = {}) {
  const kind = PRODUCT_KINDS.has(b.kind) ? b.kind : 'produto';
  const name = line(b.name, 120);
  if (name.length < 2) throw new AppError(400, 'Informe o nome.');
  const category = line(b.category, 60);
  if (!category) throw new AppError(400, 'Informe a categoria.');
  const description = typeof b.description === 'string' ? b.description.replace(/\r/g, '').trim().slice(0, 2000) : '';
  const priceCents = intIn(b.priceCents ?? 0, 0, MAX_PRICE, 'Preço');
  const rawPriceOptions = Array.isArray(b.priceOptions) ? b.priceOptions : [];
  if (rawPriceOptions.length > MAX_PRODUCT_PRICE_OPTIONS) throw new AppError(400, `Use no máximo ${MAX_PRODUCT_PRICE_OPTIONS} formas de preço.`);
  const priceOptions = rawPriceOptions.map((option) => {
    if (!option || typeof option !== 'object') throw new AppError(400, 'Forma de preço inválida.');
    if (option.id !== undefined && (!Number.isInteger(option.id) || option.id < 1)) throw new AppError(400, 'Identificador de forma de preço inválido.');
    const label = line(option.label, 40);
    if (!label) throw new AppError(400, 'Informe o nome de cada forma de preço.');
    const priceCents = option.priceCents === null || option.priceCents === undefined || option.priceCents === ''
      ? null
      : intIn(option.priceCents, 0, MAX_PRICE, `Preço de ${label}`);
    return { ...(option.id === undefined ? {} : { id: option.id }), label, priceCents };
  });
  const rawImages = Array.isArray(b.images) ? b.images : [];
  if (rawImages.length < 1) throw new AppError(400, 'Adicione pelo menos uma imagem.');
  if (rawImages.length > MAX_PRODUCT_IMAGES) throw new AppError(400, `Use no máximo ${MAX_PRODUCT_IMAGES} imagens (uma por variação).`);
  const varied = rawImages.length > 1;
  const images = rawImages.map((im, i) => {
    if (im === null || typeof im !== 'object') throw new AppError(400, 'Imagem inválida.');
    const label = line(im.label, 40);
    if (varied && !label) throw new AppError(400, `Dê um nome à variação da imagem ${i + 1} (ex.: cor ou tamanho).`);
    const out = { label: varied ? label : '', priceCents: null };
    if (im.data) out.upload = decodeProductImage(im.data);
    else if (Number.isInteger(im.id)) out.id = im.id;
    else throw new AppError(400, 'Imagem inválida.');
    return out;
  });
  return { kind, name, category, description, priceCents, active: b.active === undefined ? true : Boolean(b.active), images, priceOptions };
}

// ---------- Configuração do catálogo (entregas e frete) ----------
const ZIP = /^\d{8}$/;
const UF = /^[A-Z]{2}$/;

export const defaultCatalogConfig = () => ({
  storeName: '', whatsapp: '',
  excursion: { enabled: false },
  motoboy: { enabled: false, mode: 'fixed', fixedCents: 0, perKmCents: 0, minCents: 0, maxKm: 0, originZip: '', originStreet: '', originNumber: '', originDistrict: '', originCity: '', originState: '' },
  correios: { enabled: false, originZip: '', heightCm: 0, widthCm: 0, lengthCm: 0, weightG: 0, sandbox: false },
});

// `hasToken`: o usuário já tem (ou está enviando agora) o token do SuperFrete.
export function cleanCatalogConfig(raw, { hasToken = false } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = defaultCatalogConfig();
  const ex = r.excursion && typeof r.excursion === 'object' ? r.excursion : {};
  const mo = r.motoboy && typeof r.motoboy === 'object' ? r.motoboy : {};
  const co = r.correios && typeof r.correios === 'object' ? r.correios : {};

  const whatsapp = r.whatsapp ? normalizePhone(r.whatsapp) : '';
  if (r.whatsapp && !whatsapp) throw new AppError(400, 'WhatsApp da loja inválido. Use DDD + número.');
  const cfg = { storeName: line(r.storeName, 80), whatsapp: whatsapp || '', excursion: { enabled: Boolean(ex.enabled) }, motoboy: { ...d.motoboy }, correios: { ...d.correios } };

  // Motoboy: o usuário escolhe cobrar valor fixo ou por km. Por km, precisa informar de onde o motoboy sai (CEP ou endereço).
  cfg.motoboy.enabled = Boolean(mo.enabled);
  cfg.motoboy.mode = mo.mode === 'km' ? 'km' : 'fixed';
  cfg.motoboy.originZip = onlyDigits(mo.originZip);
  cfg.motoboy.originStreet = line(mo.originStreet, 120);
  cfg.motoboy.originNumber = line(mo.originNumber, 20);
  cfg.motoboy.originDistrict = line(mo.originDistrict, 80);
  cfg.motoboy.originCity = line(mo.originCity, 80);
  cfg.motoboy.originState = line(mo.originState, 2).toUpperCase();
  if (cfg.motoboy.originZip && !ZIP.test(cfg.motoboy.originZip)) throw new AppError(400, 'CEP de saída do motoboy inválido. Use os 8 números.');
  if (cfg.motoboy.originState && !UF.test(cfg.motoboy.originState)) throw new AppError(400, 'Estado de saída do motoboy inválido. Use a sigla, como CE.');
  cfg.motoboy.fixedCents = intIn(mo.fixedCents ?? 0, 0, MAX_PRICE, 'Valor fixo da entrega');
  cfg.motoboy.perKmCents = intIn(mo.perKmCents ?? 0, 0, MAX_PRICE, 'Valor por km');
  cfg.motoboy.minCents = intIn(mo.minCents ?? 0, 0, MAX_PRICE, 'Valor mínimo da entrega');
  cfg.motoboy.maxKm = intIn(mo.maxKm ?? 0, 0, 1000, 'Distância máxima (km)');
  if (cfg.motoboy.enabled && cfg.motoboy.mode === 'km') {
    if (!cfg.motoboy.originZip && !(cfg.motoboy.originStreet && cfg.motoboy.originCity)) {
      throw new AppError(400, 'Motoboy por km: informe o CEP ou o endereço de onde o motoboy sai, para calcular a distância.');
    }
    if (cfg.motoboy.perKmCents < 1) throw new AppError(400, 'Motoboy por km: informe o valor cobrado por km.');
  }

  // Correios (SuperFrete): CEP de origem e as medidas/peso do pacote são obrigatórios para simular o frete.
  cfg.correios.enabled = Boolean(co.enabled);
  cfg.correios.sandbox = Boolean(co.sandbox);
  cfg.correios.originZip = onlyDigits(co.originZip);
  cfg.correios.heightCm = co.heightCm === undefined || co.heightCm === '' ? 0 : numIn(co.heightCm, 0, 105, 'Altura (cm)');
  cfg.correios.widthCm = co.widthCm === undefined || co.widthCm === '' ? 0 : numIn(co.widthCm, 0, 105, 'Largura (cm)');
  cfg.correios.lengthCm = co.lengthCm === undefined || co.lengthCm === '' ? 0 : numIn(co.lengthCm, 0, 105, 'Comprimento (cm)');
  cfg.correios.weightG = co.weightG === undefined || co.weightG === '' ? 0 : intIn(co.weightG, 0, 30000, 'Peso (g)');
  if (cfg.correios.originZip && !ZIP.test(cfg.correios.originZip)) throw new AppError(400, 'CEP de origem inválido. Use os 8 números.');
  if (cfg.correios.enabled) {
    if (!cfg.correios.originZip) throw new AppError(400, 'Correios: informe o CEP de origem (de onde o pacote sai).');
    const c = cfg.correios;
    if (!(c.heightCm > 0 && c.widthCm > 0 && c.lengthCm > 0 && c.weightG > 0)) throw new AppError(400, 'Correios: informe altura, largura, comprimento e peso do pacote para simular o frete.');
    if (c.heightCm + c.widthCm + c.lengthCm > 200) throw new AppError(400, 'Correios: a soma de altura + largura + comprimento não pode passar de 200 cm.');
    if (!hasToken) throw new AppError(400, 'Correios: cole o token do SuperFrete (usado para simular o frete).');
  }
  return cfg;
}

// O que a página pública pode saber (nunca o token nem o endereço de saída).
export function publicCatalogConfig(cfg) {
  const c = { ...defaultCatalogConfig(), ...(cfg || {}) };
  return {
    storeName: c.storeName, whatsapp: c.whatsapp,
    excursion: { enabled: Boolean(c.excursion?.enabled) },
    motoboy: { enabled: Boolean(c.motoboy?.enabled), mode: c.motoboy?.mode === 'km' ? 'km' : 'fixed', fixedCents: c.motoboy?.fixedCents || 0, perKmCents: c.motoboy?.perKmCents || 0, minCents: c.motoboy?.minCents || 0, maxKm: c.motoboy?.maxKm || 0 },
    correios: { enabled: Boolean(c.correios?.enabled) },
  };
}

export const publicProduct = (p) => ({
  id: p.id, kind: p.kind, name: p.name, category: p.category, description: p.description, priceCents: p.priceCents,
  images: [...(p.images || [])].sort((a, b) => a.position - b.position).map((i) => ({ id: i.id, label: i.label, priceCents: i.priceCents, url: `/api/public/product-image/${i.id}` })),
  priceOptions: [...(p.priceOptions || [])].sort((a, b) => a.position - b.position).map((o) => ({ id: o.id, label: o.label, priceCents: o.priceCents })),
});
