// Pixels de acompanhamento para tráfego pago (só na página pública). Carrega os scripts oficiais de cada serviço
// com o identificador que o usuário informou e envia os eventos principais (visita, produto visto, carrinho, compra, contato).

const loaded = new Set();

function loadMeta(id) {
  /* eslint-disable */
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = true; t.src = v;
    s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  window.fbq('init', id);
  window.fbq('track', 'PageView');
}

function loadGoogle(id) {
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); }; // eslint-disable-line prefer-rest-params
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
  window.gtag('js', new Date());
  window.gtag('config', id);
}

function loadTikTok(id) {
  /* eslint-disable */
  (function (w, d, t) {
    w.TiktokAnalyticsObject = t;
    var ttq = w[t] = w[t] || [];
    ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie'];
    ttq.setAndDefer = function (t, e) { t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; };
    for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
    ttq.instance = function (t) { for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]); return e; };
    ttq.load = function (e, n) {
      var i = 'https://analytics.tiktok.com/i18n/pixel/events.js';
      ttq._i = ttq._i || {}; ttq._i[e] = []; ttq._i[e]._u = i; ttq._t = ttq._t || {}; ttq._t[e] = +new Date; ttq._o = ttq._o || {}; ttq._o[e] = n || {};
      var o = document.createElement('script'); o.type = 'text/javascript'; o.async = true; o.src = i + '?sdkid=' + e + '&lib=' + t;
      var a = document.getElementsByTagName('script')[0]; a.parentNode.insertBefore(o, a);
    };
    ttq.load(id); ttq.page();
  })(window, document, 'ttq');
  /* eslint-enable */
}

export function initPixels(pixel) {
  if (!pixel) return;
  if (pixel.meta && !loaded.has(`m${pixel.meta}`)) { loaded.add(`m${pixel.meta}`); loadMeta(pixel.meta); }
  if (pixel.google && !loaded.has(`g${pixel.google}`)) { loaded.add(`g${pixel.google}`); loadGoogle(pixel.google); }
  if (pixel.tiktok && !loaded.has(`t${pixel.tiktok}`)) { loaded.add(`t${pixel.tiktok}`); loadTikTok(pixel.tiktok); }
}

// Eventos: 'ViewContent' (viu um produto), 'AddToCart', 'InitiateCheckout', 'Purchase', 'Contact' (clicou no WhatsApp/telefone).
// `data`: { value (em reais), currency, name, id } — usado conforme o serviço.
const GOOGLE = { ViewContent: 'view_item', AddToCart: 'add_to_cart', InitiateCheckout: 'begin_checkout', Purchase: 'purchase', Contact: 'generate_lead' };
const TIKTOK = { ViewContent: 'ViewContent', AddToCart: 'AddToCart', InitiateCheckout: 'InitiateCheckout', Purchase: 'CompletePayment', Contact: 'Contact' };

export function track(event, data = {}) {
  try {
    const value = typeof data.value === 'number' ? data.value : undefined;
    const currency = 'BRL';
    const content = data.name ? { content_name: data.name, content_ids: data.id ? [String(data.id)] : undefined, content_type: 'product' } : {};
    if (window.fbq) window.fbq('track', event, { ...(value !== undefined ? { value, currency } : {}), ...content });
    if (window.gtag && GOOGLE[event]) window.gtag('event', GOOGLE[event], { ...(value !== undefined ? { value, currency } : {}), ...(data.transaction ? { transaction_id: data.transaction } : {}) });
    if (window.ttq && TIKTOK[event]) window.ttq.track(TIKTOK[event], { ...(value !== undefined ? { value, currency } : {}), ...(data.name ? { content_name: data.name } : {}) });
  } catch { /* o rastreamento nunca pode quebrar a página */ }
}
