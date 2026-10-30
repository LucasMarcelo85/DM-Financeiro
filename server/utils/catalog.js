import { AppError, normalizePhone, onlyDigits } from './helpers.js';

// Validação (lista branca) de produtos, configuração do catálogo e pedidos. Nada além do que está aqui chega ao banco.

export const PRODUCT_KINDS = new Set(['produto', 'servico']);
export const MAX_PRODUCT_IMAGES = 12;
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
  if (b.stockEnabled !== undefined && typeof b.stockEnabled !== 'boolean') throw new AppError(400, 'Informe se o produto controla estoque.');
  const stockEnabled = Boolean(b.stockEnabled);
  const stockQuantity = intIn(b.stockQuantity ?? 0, 0, 1_000_000, 'Estoque');
  const rawPriceOptions = Array.isArray(b.priceOptions) ? b.priceOptions : [];
  if (rawPriceOptions.length > MAX_PRODUCT_PRICE_OPTIONS) throw new AppError(400, `Use no máximo ${MAX_PRODUCT_PRICE_OPTIONS} formas de preço.`);
  const priceOptions = rawPriceOptions.map((option) => {
    if (!option || typeof option !== 'object') throw new AppError(400, 'Forma de preço inválida.');
    if (option.id !== undefined && (!Number.isInteger(option.id) || option.id < 1)) throw new AppError(400, 'Identificador de forma de preço inválido.');
    const label = line(option.label, 40);
    if (!label) throw new AppError(400, 'Informe o nome de cada forma de preço.');
    const minQuantity = intIn(option.minQuantity ?? 1, 1, 999, `Quantidade mínima de ${label}`);
    const scope = option.scope === undefined ? 'same_product' : option.scope;
    if (!['same_product', 'cart_quantity', 'cart_value'].includes(scope)) throw new AppError(400, `Critério de preço inválido para ${label}.`);
    const minCartCents = intIn(option.minCartCents ?? 0, 0, MAX_PRICE, `Valor mínimo do carrinho para ${label}`);
    const priceCents = option.priceCents === null || option.priceCents === undefined || option.priceCents === ''
      ? null
      : intIn(option.priceCents, 0, MAX_PRICE, `Preço de ${label}`);
    return { ...(option.id === undefined ? {} : { id: option.id }), label, priceCents, minQuantity, scope, minCartCents };
  });
  const explicitMainImage = Object.hasOwn(b, 'mainImage');
  const rawImages = Array.isArray(b.images) ? b.images : [];
  const rawMainImage = explicitMainImage ? b.mainImage : rawImages[0] || null;
  const rawVariations = explicitMainImage ? rawImages : rawImages.slice(1);
  if (rawVariations.length + Number(Boolean(rawMainImage)) > MAX_PRODUCT_IMAGES) throw new AppError(400, `Use no máximo ${MAX_PRODUCT_IMAGES} imagens no produto.`);
  const images = [];
  const cleanImage = (im, i, isPrimary) => {
    if (im === null || typeof im !== 'object') throw new AppError(400, 'Imagem inválida.');
    const size = isPrimary ? '' : line(im.size, 20);
    const color = isPrimary ? '' : line(im.color, 20);
    const colorHex = !isPrimary && /^#[0-9a-fA-F]{6}$/.test(im.colorHex || '') ? im.colorHex.toLowerCase() : '';
    const stockQuantity = intIn(im.stockQuantity ?? 0, 0, 1_000_000, `Estoque da variação ${i + 1}`);
    const label = isPrimary ? '' : (line(im.label, 100) || [color, size].filter(Boolean).join(' · '));
    if (!isPrimary && !label && !Number.isInteger(im.id)) throw new AppError(400, `Informe ao menos uma característica para a variação ${i + 1}.`);
    const out = { isPrimary, label, size, color, colorHex, priceCents: null, stockQuantity: isPrimary ? 0 : stockQuantity };
    if (im.data) out.upload = decodeProductImage(im.data);
    else if (Number.isInteger(im.id)) out.id = im.id;
    else throw new AppError(400, 'Imagem inválida.');
    return out;
  };
  if (rawMainImage) images.push(cleanImage(rawMainImage, 0, true));
  for (const [index, image] of rawVariations.entries()) images.push(cleanImage(image, index + Number(Boolean(rawMainImage)), false));
  return { kind, name, category, description, priceCents, stockEnabled, stockQuantity, active: b.active === undefined ? true : Boolean(b.active), images, priceOptions };
}

// ---------- Configuração do catálogo (entregas e frete) ----------
const ZIP = /^\d{8}$/;
const UF = /^[A-Z]{2}$/;

export const defaultCatalogConfig = () => ({
  storeName: '', whatsapp: '',
  orderNotifications: { enabled: false, instanceId: null },
  checkout: { minItems: 1, minSubtotalCents: 0 },
  pickup: { enabled: false, name: '', address: '' },
  excursion: { enabled: false },
  motoboy: { enabled: false, mode: 'fixed', fixedCents: 0, perKmCents: 0, minCents: 0, maxKm: 0, originZip: '', originStreet: '', originNumber: '', originDistrict: '', originCity: '', originState: '' },
  correios: { enabled: false, originZip: '', heightCm: 0, widthCm: 0, lengthCm: 0, weightG: 0, sandbox: false },
});

// `hasToken`: há credencial do SuperFrete configurada no servidor ou legada para este usuário.
export function cleanCatalogConfig(raw, { hasToken = false } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = defaultCatalogConfig();
  const ex = r.excursion && typeof r.excursion === 'object' ? r.excursion : {};
  const pickup = r.pickup && typeof r.pickup === 'object' ? r.pickup : {};
  const mo = r.motoboy && typeof r.motoboy === 'object' ? r.motoboy : {};
  const co = r.correios && typeof r.correios === 'object' ? r.correios : {};
  const checkout = r.checkout && typeof r.checkout === 'object' ? r.checkout : {};
  const notifications = r.orderNotifications && typeof r.orderNotifications === 'object' ? r.orderNotifications : {};

  const whatsapp = r.whatsapp ? normalizePhone(r.whatsapp) : '';
  if (r.whatsapp && !whatsapp) throw new AppError(400, 'WhatsApp da loja inválido. Use DDD + número.');
  const notificationsEnabled = Boolean(notifications.enabled);
  const notificationInstanceId = !notificationsEnabled || notifications.instanceId === '' || notifications.instanceId === null || notifications.instanceId === undefined
    ? null
    : intIn(notifications.instanceId, 1, Number.MAX_SAFE_INTEGER, 'Instância de notificação');
  if (notificationsEnabled && (!whatsapp || !notificationInstanceId)) {
    throw new AppError(400, 'Informe o WhatsApp da loja e escolha uma instância para receber as notificações.');
  }
  const cfg = {
    storeName: line(r.storeName, 80), whatsapp: whatsapp || '',
    orderNotifications: { enabled: notificationsEnabled, instanceId: notificationInstanceId },
    checkout: {
      minItems: intIn(checkout.minItems ?? d.checkout.minItems, 1, 999, 'Quantidade mínima do pedido'),
      minSubtotalCents: intIn(checkout.minSubtotalCents ?? d.checkout.minSubtotalCents, 0, MAX_PRICE, 'Valor mínimo do pedido'),
    },
    pickup: { enabled: Boolean(pickup.enabled), name: line(pickup.name, 80), address: line(pickup.address, 240) },
    excursion: { enabled: Boolean(ex.enabled) }, motoboy: { ...d.motoboy }, correios: { ...d.correios },
  };
  if (cfg.pickup.enabled && cfg.pickup.address.length < 3) throw new AppError(400, 'Retirada: informe o endereço ou ponto de retirada.');

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
    if (!hasToken) throw new AppError(400, 'Correios: o SuperFrete não está configurado no servidor. Avise o administrador.');
  }
  return cfg;
}

// O que a página pública pode saber (nunca o token nem o endereço de saída).
export function publicCatalogConfig(cfg) {
  const c = { ...defaultCatalogConfig(), ...(cfg || {}) };
  return {
    storeName: c.storeName, whatsapp: c.whatsapp,
    checkout: { minItems: c.checkout?.minItems || 1, minSubtotalCents: c.checkout?.minSubtotalCents || 0 },
    pickup: { enabled: Boolean(c.pickup?.enabled), name: line(c.pickup?.name, 80), address: line(c.pickup?.address, 240) },
    excursion: { enabled: Boolean(c.excursion?.enabled) },
    motoboy: { enabled: Boolean(c.motoboy?.enabled), mode: c.motoboy?.mode === 'km' ? 'km' : 'fixed', fixedCents: c.motoboy?.fixedCents || 0, perKmCents: c.motoboy?.perKmCents || 0, minCents: c.motoboy?.minCents || 0, maxKm: c.motoboy?.maxKm || 0 },
    correios: { enabled: Boolean(c.correios?.enabled) },
  };
}

export const publicProduct = (p) => {
  const images = [...(p.images || [])].sort((a, b) => a.position - b.position);
  const mainImage = images.find((image) => image.isPrimary);
  const imageDto = (image) => ({
    id: image.id,
    label: image.label,
    size: image.size || '',
    color: image.color || '',
    colorHex: image.colorHex || '',
    priceCents: image.priceCents,
    stockQuantity: image.stockQuantity ?? 0,
    url: `/api/public/product-image/${image.id}`,
  });
  return {
    id: p.id, kind: p.kind, name: p.name, category: p.category, description: p.description, priceCents: p.priceCents,
    stockEnabled: Boolean(p.stockEnabled), stockQuantity: p.stockQuantity ?? 0,
    mainImage: mainImage ? { id: mainImage.id, url: `/api/public/product-image/${mainImage.id}` } : null,
    images: images.filter((image) => !image.isPrimary).map(imageDto),
    priceOptions: [...(p.priceOptions || [])].sort((a, b) => a.position - b.position).map((o) => ({ id: o.id, label: o.label, priceCents: o.priceCents, minQuantity: o.minQuantity || 1, scope: o.scope || 'same_product', minCartCents: o.minCartCents || 0 })),
  };
};
