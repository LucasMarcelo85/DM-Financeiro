import { config } from '../config.js';
import { AppError, onlyDigits, sleep } from '../utils/helpers.js';

// Endereço, distância e frete do catálogo.
//  - CEP -> endereço: ViaCEP (gratuito, sem chave).
//  - Endereço -> coordenadas: Nominatim/OpenStreetMap. Rota por estrada (km): OSRM. Se a rota falhar, usa a distância em linha reta x 1,3.
//  - Frete dos Correios: SuperFrete (o token é de cada usuário, guardado no banco, nunca no .env).
// Serviços públicos gratuitos têm limite de uso: os resultados ficam em cache por algumas horas.

const TIMEOUT_MS = 9000;
const UA = 'DM-Financeiro/1.0 (catalogo digital)';
const SUPERFRETE_UA = config.geo.superfreteUserAgent;

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, exp: Date.now() + ttlMs });
  if (cache.size > 2000) for (const k of cache.keys()) { cache.delete(k); if (cache.size <= 1500) break; }
  return value;
}

async function getJson(url, { headers = {}, label }) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new AppError(502, `${label} não respondeu agora. Tente novamente em instantes.`, 'GEO_UNAVAILABLE');
  }
  if (!res.ok) throw new AppError(res.status === 404 ? 404 : 502, `${label} não conseguiu atender esse pedido.`, 'GEO_UNAVAILABLE');
  return res.json().catch(() => { throw new AppError(502, `${label} respondeu algo inesperado.`, 'GEO_UNAVAILABLE'); });
}

// ---------- CEP ----------
export async function lookupCep(cep) {
  const zip = onlyDigits(cep);
  if (zip.length !== 8) throw new AppError(400, 'CEP inválido. Use os 8 números.');
  return cached(`cep:${zip}`, 24 * 3600_000, async () => {
    const d = await getJson(`${config.geo.viacep}/ws/${zip}/json/`, { label: 'A consulta de CEP' });
    if (!d || d.erro) throw new AppError(404, 'CEP não encontrado. Confira os números.');
    return { zip, street: d.logradouro || '', district: d.bairro || '', city: d.localidade || '', state: d.uf || '', complement: d.complemento || '' };
  });
}

// ---------- Coordenadas ----------
let lastNominatim = 0;
async function nominatim(q) {
  // A política do OpenStreetMap pede no máximo 1 consulta por segundo no servidor público.
  if (config.geo.nominatim === 'https://nominatim.openstreetmap.org') {
    const wait = lastNominatim + 1100 - Date.now();
    lastNominatim = Date.now() + Math.max(0, wait);
    if (wait > 0) await sleep(wait);
  }
  const rows = await getJson(`${config.geo.nominatim}/search?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`, { label: 'O mapa' });
  const r = Array.isArray(rows) ? rows[0] : null;
  const lat = Number(r?.lat);
  const lon = Number(r?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

// Tenta do mais exato (rua + número) ao mais amplo (cidade). Devolve { lat, lon, precision }.
export async function geocode(a) {
  const addr = { ...a };
  if (addr.zip && (!addr.street || !addr.city)) {
    const found = await lookupCep(addr.zip).catch(() => null);
    if (found) Object.assign(addr, { street: addr.street || found.street, district: addr.district || found.district, city: addr.city || found.city, state: addr.state || found.state });
  }
  const tries = [];
  if (addr.street && addr.city) tries.push(['address', [`${addr.street}${addr.number ? `, ${addr.number}` : ''}`, addr.district, addr.city, addr.state, 'Brasil']]);
  if (addr.street && addr.city && addr.number) tries.push(['street', [addr.street, addr.city, addr.state, 'Brasil']]);
  if (addr.city) tries.push(['city', [addr.city, addr.state, 'Brasil']]);
  for (const [precision, parts] of tries) {
    const q = parts.filter(Boolean).join(', ');
    const hit = await cached(`geo:${q.toLowerCase()}`, 12 * 3600_000, () => nominatim(q));
    if (hit) return { ...hit, precision };
  }
  throw new AppError(422, 'Não encontrei esse endereço no mapa. Confira o CEP ou preencha rua e cidade.', 'ADDRESS_NOT_FOUND');
}

// ---------- Distância ----------
export function haversineKm(a, b) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function drivingKm(a, b) {
  const key = `route:${a.lat.toFixed(4)},${a.lon.toFixed(4)};${b.lat.toFixed(4)},${b.lon.toFixed(4)}`;
  return cached(key, 6 * 3600_000, async () => {
    try {
      const d = await getJson(`${config.geo.osrm}/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`, { label: 'O cálculo de rota' });
      const m = d?.routes?.[0]?.distance;
      if (d?.code === 'Ok' && Number.isFinite(m)) return { km: Math.round((m / 1000) * 10) / 10, approx: false };
    } catch { /* cai na distância em linha reta */ }
    return { km: Math.round(haversineKm(a, b) * 1.3 * 10) / 10, approx: true };
  });
}

// ---------- Motoboy ----------
// `dest`: { zip, street, number, district, city, state } (CEP ou endereço). Devolve { priceCents, km?, approx? }.
export async function quoteMotoboy(cfg, dest) {
  const m = cfg.motoboy;
  if (m.mode !== 'km') return { priceCents: m.fixedCents, km: null, approx: false };
  const [from, to] = await Promise.all([
    geocode({ zip: m.originZip, street: m.originStreet, number: m.originNumber, district: m.originDistrict, city: m.originCity, state: m.originState }),
    geocode(dest),
  ]);
  const { km, approx } = await drivingKm(from, to);
  if (m.maxKm > 0 && km > m.maxKm) throw new AppError(422, `Fora da área de entrega: a loja entrega até ${m.maxKm} km e o seu endereço fica a cerca de ${km} km.`, 'OUT_OF_RANGE');
  return { priceCents: Math.max(m.minCents, Math.round(km * m.perKmCents)), km, approx: approx || to.precision === 'city' };
}

// ---------- Correios pelo SuperFrete ----------
// Serviços: 1 = PAC, 2 = SEDEX, 17 = Mini Envios. Os nomes e prazos mostrados vêm da resposta da API.
const toMoneyCents = (v) => {
  if (typeof v === 'string' && !v.trim()) return null;
  const n = typeof v === 'string' ? (v.includes(',') ? Number(v.replace(/\./g, '').replace(',', '.')) : Number(v)) : v;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const deliveryDays = (option) => {
  const raw = option.custom_delivery_time ?? option.delivery_time ?? option.delivery_range;
  if (raw && typeof raw === 'object') {
    const max = Number(raw.max);
    const min = Number(raw.min ?? max);
    return Number.isFinite(max) ? { min: Number.isFinite(min) ? min : max, max } : null;
  }
  const days = Number(raw);
  return Number.isFinite(days) ? { min: days, max: days } : null;
};

export async function quoteCorreios({ token = config.geo.superfreteToken, sandbox = false, correios, toZip, insuranceCents = 0 }) {
  const to = onlyDigits(toZip);
  if (to.length !== 8) throw new AppError(400, 'Informe o CEP de destino com 8 números.');
  // Mínimos aceitos pelos Correios: 16 x 11 x 2 cm.
  const pkg = {
    height: Math.max(2, correios.heightCm), width: Math.max(11, correios.widthCm), length: Math.max(16, correios.lengthCm),
    weight: Math.max(0.01, Math.round(correios.weightG) / 1000), // em kg
  };
  if (!token) throw new AppError(503, 'O frete dos Correios não está configurado no servidor. Avise o administrador.', 'SHIPPING_UNAVAILABLE');
  const authorization = /^Bearer\s/i.test(token) ? token : `Bearer ${token}`;
  const url = `${sandbox ? config.geo.superfreteSandbox : config.geo.superfrete}/api/v0/calculator`;
  const call = async (withInsurance) => {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: authorization, 'User-Agent': SUPERFRETE_UA },
        body: JSON.stringify({
          from: { postal_code: onlyDigits(correios.originZip) }, to: { postal_code: to }, services: '1,2,17', package: pkg,
          options: { own_hand: false, receipt: false, insurance_value: withInsurance ? insuranceCents / 100 : 0, use_insurance_value: withInsurance },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS + 3000),
      });
    } catch (e) {
      console.error('[superfrete] sem resposta:', e?.message);
      return { res: null, rows: [], data: null };
    }
    const data = await res.json().catch(() => null);
    const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    if (!res.ok || !rows.length) console.error('[superfrete] falha', res.status, JSON.stringify(data)?.slice(0, 300));
    return { res, rows, data };
  };
  let { res, rows: resultRows, data } = await call(insuranceCents > 0);
  // Se a simulação com seguro falhar (valor declarado recusado), tenta de novo sem seguro.
  // Só tenta de novo sem seguro quando o SuperFrete respondeu com erro; sem resposta (timeout) não dobra a espera.
  if (res && (!res.ok || !resultRows.length) && res.status !== 401 && res.status !== 403) ({ res, rows: resultRows, data } = await call(false));
  const reason = String(data?.message || data?.error || (data?.errors && JSON.stringify(data.errors)) || '').replace(/\s+/g, ' ').slice(0, 160);
  const detail = reason ? ` (${reason})` : '';
  if (!res) throw new AppError(424, 'O SuperFrete não respondeu agora. Tente novamente em instantes.', 'SHIPPING_UNAVAILABLE');
  if (res.status === 401 || res.status === 403) throw new AppError(424, `O SuperFrete recusou o token${sandbox ? ' (modo teste ligado: use o token do ambiente de testes ou desligue o modo teste)' : ' (confira se o token é de produção)'}. Avise o administrador.${detail}`, 'SHIPPING_TOKEN');
  if (!res.ok || !resultRows.length) throw new AppError(res.status === 422 || res.status === 400 ? 422 : 424, `Não foi possível simular o frete para esse CEP${detail}. Confira o CEP de destino e as medidas do pacote.`, 'SHIPPING_UNAVAILABLE');
  const options = resultRows
    .filter((o) => o && !o.error && o.id !== undefined)
    .map((o) => {
      const cents = toMoneyCents(o.custom_price) ?? toMoneyCents(o.price);
      const days = deliveryDays(o);
      return cents === null ? null : {
        id: String(o.id), name: String(o.name || 'Correios').slice(0, 40), priceCents: cents,
        days,
        company: String(o.company?.name || 'Correios').slice(0, 40),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.priceCents - b.priceCents);
  if (!options.length) throw new AppError(422, 'Nenhum serviço dos Correios atende esse CEP com as medidas do pacote.', 'SHIPPING_UNAVAILABLE');
  return options;
}
