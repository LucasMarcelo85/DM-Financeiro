// Pontos de partida do portfólio. São exemplos: o usuário troca textos, cores, imagens e links no editor e arrasta tudo para onde quiser.
// Cada modelo é desenhado no computador; tablet e celular nascem já ajustados (proporcional ou em coluna) e podem ser refinados à parte.
import { THEME_PRESETS } from './model.js';
import { DESIGN_W, FILL0, adaptDevice, blankDoc, newElement } from './doc.js';

const preset = (key) => { const { primary, bg, text } = THEME_PRESETS.find((p) => p.key === key); return { primary, bg, text }; };
const wa = (message = 'Olá! Vi sua página e gostaria de saber mais.') => ({ kind: 'whatsapp', url: '', phone: '', message, email: '' });
const url = () => ({ kind: 'link', url: '', phone: '', message: '', email: '' });

export const SITE_TEMPLATES = [
  { key: 'blank', label: 'Em branco', desc: 'Comece do zero e arraste os elementos para onde quiser.' },
  { key: 'links', label: 'Cartão de links', desc: 'Foto, apresentação curta e botões: WhatsApp, Instagram e site.' },
  { key: 'services', label: 'Serviços e portfólio', desc: 'Banner animado, sobre você, três serviços e contato.' },
  { key: 'promo', label: 'Página de oferta', desc: 'Fundo com cores em movimento, destaque animado e botão chamativo.' },
];
export const CATALOG_TEMPLATES = [
  { key: 'catalog', label: 'Catálogo digital', desc: 'Topo com nome da loja e botão de WhatsApp; produtos, carrinho e pedido prontos.' },
  { key: 'catalog-bold', label: 'Catálogo colorido', desc: 'Topo com degradê animado e formas decorativas.' },
  { key: 'catalog-minimal', label: 'Loja minimalista', desc: 'Visual limpo, elegante e direto ao catálogo.' },
  { key: 'catalog-editorial', label: 'Loja editorial', desc: 'Capa sofisticada com destaque para a marca e o carrinho.' },
];
export const TEMPLATES = [...SITE_TEMPLATES, ...CATALOG_TEMPLATES];

function setMobileBox(doc, index, box) {
  const element = doc.elements[index];
  if (!element) return;
  element.box.mobile = { ...element.box.mobile, ...box, r: 0, hide: false };
}

function hideOnMobile(doc, ...indices) {
  for (const index of indices) {
    const element = doc.elements[index];
    if (element) element.box.mobile = { ...element.box.mobile, hide: true };
  }
}

function mobileLayout(doc, key) {
  const W = DESIGN_W.mobile;
  if (key === 'links') {
    setMobileBox(doc, 0, { x: 137, y: 28, w: 100, h: 100 });
    setMobileBox(doc, 1, { x: 147, y: 38, w: 80, h: 80 });
    setMobileBox(doc, 2, { x: 24, y: 154, w: W - 48, h: 58, fs: 27 });
    setMobileBox(doc, 3, { x: 30, y: 218, w: W - 60, h: 92, fs: 16 });
    [4, 5, 6].forEach((index, i) => setMobileBox(doc, index, { x: 30, y: 326 + i * 64, w: W - 60, h: 52, fs: 16 }));
    doc.heights.mobile = 550;
  } else if (key === 'services') {
    setMobileBox(doc, 0, { x: 0, y: 0, w: W, h: 320 });
    hideOnMobile(doc, 1, 2);
    setMobileBox(doc, 3, { x: 24, y: 68, w: W - 48, h: 76, fs: 34 });
    setMobileBox(doc, 4, { x: 28, y: 150, w: W - 56, h: 58, fs: 17 });
    setMobileBox(doc, 5, { x: 42, y: 228, w: W - 84, h: 52, fs: 16 });
    setMobileBox(doc, 6, { x: 24, y: 354, w: W - 48, h: 44, fs: 28 });
    setMobileBox(doc, 7, { x: 28, y: 405, w: W - 56, h: 88, fs: 16 });
    for (let card = 0; card < 3; card += 1) {
      const start = 8 + card * 4;
      const y = 520 + card * 238;
      setMobileBox(doc, start, { x: 20, y, w: W - 40, h: 218 });
      setMobileBox(doc, start + 1, { x: 40, y: y + 20, w: 54, h: 54 });
      setMobileBox(doc, start + 2, { x: 40, y: y + 88, w: W - 80, h: 34, fs: 20 });
      setMobileBox(doc, start + 3, { x: 40, y: y + 130, w: W - 80, h: 72, fs: 14 });
    }
    setMobileBox(doc, 20, { x: 24, y: 1270, w: W - 48, h: 48, fs: 27 });
    setMobileBox(doc, 21, { x: 42, y: 1334, w: W - 84, h: 52, fs: 16 });
    doc.heights.mobile = 1420;
  } else if (key === 'catalog' || key === 'catalog-bold') {
    setMobileBox(doc, 0, { x: 0, y: 0, w: W, h: 285 });
    if (key === 'catalog') {
      setMobileBox(doc, 1, { x: 28, y: 32, w: 76, h: 76 });
      setMobileBox(doc, 2, { x: 24, y: 116, w: W - 48, h: 54, fs: 32 });
      setMobileBox(doc, 3, { x: 26, y: 174, w: W - 52, h: 55, fs: 16 });
      setMobileBox(doc, 4, { x: 36, y: 236, w: W - 72, h: 44, fs: 15 });
    } else {
      hideOnMobile(doc, 1, 2);
      setMobileBox(doc, 3, { x: 24, y: 60, w: W - 48, h: 62, fs: 34 });
      setMobileBox(doc, 4, { x: 26, y: 130, w: W - 52, h: 56, fs: 16 });
      setMobileBox(doc, 5, { x: 36, y: 204, w: W - 72, h: 48, fs: 15 });
    }
    doc.heights.mobile = 300;
  } else if (key === 'catalog-minimal') {
    setMobileBox(doc, 0, { x: 18, y: 24, w: W - 36, h: 205 });
    setMobileBox(doc, 1, { x: 36, y: 48, w: W - 72, h: 54, fs: 30 });
    setMobileBox(doc, 2, { x: 36, y: 106, w: W - 72, h: 55, fs: 15 });
    setMobileBox(doc, 3, { x: 50, y: 169, w: W - 100, h: 44, fs: 15 });
    doc.heights.mobile = 255;
  } else if (key === 'catalog-editorial') {
    setMobileBox(doc, 0, { x: 0, y: 0, w: W, h: 286 });
    hideOnMobile(doc, 1);
    setMobileBox(doc, 2, { x: 24, y: 38, w: W - 48, h: 26, fs: 12 });
    setMobileBox(doc, 3, { x: 24, y: 76, w: W - 48, h: 80, fs: 34 });
    setMobileBox(doc, 4, { x: 26, y: 164, w: W - 52, h: 52, fs: 16 });
    setMobileBox(doc, 5, { x: 36, y: 226, w: W - 72, h: 48, fs: 15 });
    doc.heights.mobile = 300;
  }
}

// Tablet acompanha o desenho amplo; celular recebe um arranjo próprio para manter os elementos legíveis.
function finish(doc, key) {
  let d = adaptDevice(doc, 'desktop', 'tablet');
  mobileLayout(d, key);
  return { ...d, manual: { tablet: true, mobile: true } };
}

// `name`: nome da pessoa ou empresa (vem do cadastro) para já aparecer na página.
export function buildTemplate(key, name = 'Sua empresa') {
  const kind = key.startsWith('catalog') ? 'catalog' : 'site';
  const doc = blankDoc(kind);
  const th = doc.theme;
  const E = (t, over) => newElement(t, doc.theme, over);
  const box = (x, y, w, h, fs) => ({ x, y, w, h, ...(fs ? { fs } : {}) });

  if (key === 'links') {
    doc.theme = { ...th, ...preset('grafite'), headingFont: 'montserrat' };
    doc.seo = { title: name, description: `Fale com ${name}.` };
    doc.heights.desktop = 620;
    doc.elements = [
      E('shape', { shape: 'circle', fill: FILL0({ type: 'gradient', c1: '#27496d', c2: '#6d4aff', animate: 'flow' }), box: box(520, 40, 160, 160), anim: { enter: 'zoom-in' } }),
      E('image', { mask: 'circle', fit: 'cover', box: box(530, 50, 140, 140), anim: { enter: 'zoom-in', delay: 100 } }),
      E('text', { text: name, align: 'center', font: 'montserrat', weight: 700, box: box(380, 220, 440, 50, 34), anim: { enter: 'fade', delay: 150 } }),
      E('text', { text: 'Uma frase curta sobre o que você faz e como as pessoas podem falar com você.', align: 'center', box: box(380, 280, 440, 60, 18), anim: { enter: 'fade', delay: 250 } }),
      E('button', { label: 'Chamar no WhatsApp', link: wa(), icon: 'whatsapp', style: 'solid', radius: 999, box: box(380, 370, 440, 58, 18), anim: { enter: 'slide-up', delay: 300 } }),
      E('button', { label: 'Instagram', link: url(), icon: 'instagram', style: 'outline', radius: 999, box: box(380, 444, 440, 58, 18), anim: { enter: 'slide-up', delay: 400 } }),
      E('button', { label: 'Nosso site', link: url(), icon: 'globe', style: 'soft', radius: 999, box: box(380, 518, 440, 58, 18), anim: { enter: 'slide-up', delay: 500 } }),
    ];
  } else if (key === 'services') {
    doc.theme = { ...th, ...preset('oceano') };
    doc.seo = { title: name, description: `Conheça o trabalho de ${name}.` };
    doc.heights.desktop = 1180;
    const card = (x, icon, title, desc, delay) => [
      E('shape', { shape: 'rect', radius: 18, fill: FILL0({ c1: '#ffffff' }), shadow: 'medium', box: box(x, 640, 340, 250), anim: { enter: 'slide-up', delay } }),
      E('icon', { name: icon, color: '#ffffff', bg: 'circle', bgColor: '#1f55a6', box: box(x + 28, 666, 64, 64), anim: { enter: 'zoom-in', delay: delay + 100, hover: 'rotate' } }),
      E('text', { text: title, font: 'playfair', weight: 700, color: '#14202e', box: box(x + 28, 748, 284, 36, 24), anim: { enter: 'fade', delay: delay + 150 } }),
      E('text', { text: desc, color: '#4a5a6c', box: box(x + 28, 790, 284, 80, 16), anim: { enter: 'fade', delay: delay + 200 } }),
    ];
    doc.elements = [
      E('shape', { shape: 'rect', fill: FILL0({ type: 'gradient', c1: '#1f55a6', c2: '#6d4aff', angle: 120, animate: 'flow' }), box: box(0, 0, 1200, 430) }),
      E('shape', { shape: 'circle', fill: FILL0({ c1: '#ffffff' }), opacity: 12, box: box(900, 40, 260, 260), anim: { loop: 'float' } }),
      E('shape', { shape: 'ring', radius: 14, fill: FILL0({ c1: '#ffffff' }), opacity: 25, box: box(80, 250, 150, 150), anim: { loop: 'spin' } }),
      E('text', { text: name, align: 'center', font: 'playfair', weight: 700, color: '#ffffff', box: box(200, 120, 800, 80, 58), anim: { enter: 'slide-up' } }),
      E('text', { text: 'Soluções sob medida para o seu negócio.', align: 'center', color: '#e6efff', box: box(250, 215, 700, 40, 22), anim: { enter: 'fade', delay: 200 } }),
      E('button', { label: 'Peça um orçamento', link: wa(), icon: 'whatsapp', style: 'lift', color: '#ffffff', textColor: '#1f55a6', radius: 999, box: box(460, 290, 280, 60, 19), anim: { enter: 'zoom-in', delay: 400, loop: 'pulse' } }),
      E('text', { text: 'Sobre nós', align: 'center', font: 'playfair', weight: 700, box: box(300, 480, 600, 50, 38), anim: { enter: 'fade' } }),
      E('text', { text: 'Conte aqui a sua história, há quanto tempo atua e o que torna o seu trabalho diferente.', align: 'center', box: box(300, 540, 600, 70, 18), anim: { enter: 'fade', delay: 100 } }),
      ...card(60, 'star', 'Serviço 1', 'Descreva em poucas linhas o que está incluso neste serviço.', 0),
      ...card(430, 'zap', 'Serviço 2', 'Descreva em poucas linhas o que está incluso neste serviço.', 120),
      ...card(800, 'award', 'Serviço 3', 'Descreva em poucas linhas o que está incluso neste serviço.', 240),
      E('text', { text: 'Vamos conversar?', align: 'center', font: 'playfair', weight: 700, box: box(300, 950, 600, 50, 36), anim: { enter: 'fade' } }),
      E('button', { label: 'Falar no WhatsApp', link: wa(), icon: 'whatsapp', style: 'solid', radius: 14, box: box(470, 1020, 260, 58, 18), anim: { enter: 'slide-up' } }),
    ];
  } else if (key === 'promo') {
    doc.theme = { ...th, primary: '#ff4d6d', bg: '#1b1034', text: '#ffffff', bgType: 'gradient', bgColor2: '#5b21b6', bgAngle: 135, bgAnimate: 'flow', headingFont: 'montserrat' };
    doc.seo = { title: `Oferta: ${name}`, description: 'Aproveite esta oferta por tempo limitado.' };
    doc.heights.desktop = 760;
    doc.elements = [
      E('shape', { shape: 'circle', fill: FILL0({ type: 'gradient', c1: '#ff4d6d', c2: '#ffb347', animate: 'hue' }), opacity: 70, box: box(90, 110, 220, 220), anim: { loop: 'float' } }),
      E('shape', { shape: 'star', fill: FILL0({ c1: '#ffd166' }), box: box(940, 90, 130, 130), anim: { loop: 'spin' } }),
      E('shape', { shape: 'hexagon', fill: FILL0({ type: 'gradient', c1: '#22d3ee', c2: '#6366f1', animate: 'flow' }), opacity: 60, box: box(990, 420, 150, 150), anim: { loop: 'float' } }),
      E('text', { text: 'OFERTA POR TEMPO LIMITADO', align: 'center', color: '#ffd166', weight: 700, spacing: 3, box: box(250, 120, 700, 30, 18), anim: { enter: 'fade' } }),
      E('text', { text: 'Seu título de impacto aqui', align: 'center', font: 'montserrat', weight: 700, useFill: true, fill: FILL0({ type: 'gradient', c1: '#ffffff', c2: '#ffd166', angle: 90, animate: 'flow' }), box: box(150, 170, 900, 150, 68), anim: { enter: 'slide-up', delay: 150 } }),
      E('text', { text: 'Explique em uma frase o benefício principal e por que vale agir agora.', align: 'center', color: '#e9defc', box: box(260, 345, 680, 70, 22), anim: { enter: 'fade', delay: 300 } }),
      E('button', { label: 'Quero aproveitar', link: wa('Olá! Quero aproveitar a oferta.'), icon: 'arrow-right', iconPos: 'right', style: 'flow', color: '#ff4d6d', color2: '#ffb347', textColor: '#1b1034', radius: 999, box: box(430, 450, 340, 72, 22), anim: { enter: 'zoom-in', delay: 500, loop: 'pulse' } }),
      E('icon', { name: 'check-circle', color: '#6ee7b7', box: box(300, 590, 36, 36), anim: { enter: 'fade', delay: 600 } }),
      E('text', { text: 'Benefício 1', color: '#ffffff', box: box(346, 594, 180, 30, 18), anim: { enter: 'fade', delay: 650 } }),
      E('icon', { name: 'check-circle', color: '#6ee7b7', box: box(530, 590, 36, 36), anim: { enter: 'fade', delay: 700 } }),
      E('text', { text: 'Benefício 2', color: '#ffffff', box: box(576, 594, 180, 30, 18), anim: { enter: 'fade', delay: 750 } }),
      E('icon', { name: 'check-circle', color: '#6ee7b7', box: box(760, 590, 36, 36), anim: { enter: 'fade', delay: 800 } }),
      E('text', { text: 'Benefício 3', color: '#ffffff', box: box(806, 594, 180, 30, 18), anim: { enter: 'fade', delay: 850 } }),
    ];
  } else if (key === 'catalog') {
    doc.theme = { ...th, ...preset('floresta'), headingFont: 'montserrat' };
    doc.seo = { title: `${name} — Catálogo`, description: `Veja os produtos de ${name} e faça seu pedido.` };
    doc.heights.desktop = 260;
    doc.elements = [
      E('shape', { shape: 'rect', fill: FILL0({ c1: '#137a52' }), box: box(0, 0, 1200, 260) }),
      E('image', { mask: 'circle', fit: 'cover', box: box(80, 60, 140, 140), borderW: 4, anim: { enter: 'zoom-in' } }),
      E('text', { text: name, font: 'montserrat', weight: 700, color: '#ffffff', box: box(250, 70, 620, 60, 46), anim: { enter: 'slide-right' } }),
      E('text', { text: 'Escolha seus produtos, monte o carrinho e finalize o pedido.', color: '#dff5ea', box: box(250, 140, 620, 60, 19), anim: { enter: 'fade', delay: 150 } }),
      E('button', { label: 'Fale com a loja', link: wa(), icon: 'whatsapp', style: 'lift', color: '#ffffff', textColor: '#137a52', radius: 999, box: box(920, 95, 220, 56, 17), anim: { enter: 'zoom-in', delay: 300 } }),
    ];
  } else if (key === 'catalog-bold') {
    doc.theme = { ...th, ...preset('rosa'), headingFont: 'poppins' };
    doc.seo = { title: `${name} — Catálogo`, description: `Veja os produtos de ${name} e faça seu pedido.` };
    doc.heights.desktop = 300;
    doc.elements = [
      E('shape', { shape: 'rect', fill: FILL0({ type: 'gradient', c1: '#d6336c', c2: '#7c3aed', angle: 120, animate: 'flow' }), box: box(0, 0, 1200, 300) }),
      E('shape', { shape: 'circle', fill: FILL0({ c1: '#ffffff' }), opacity: 14, box: box(930, 20, 240, 240), anim: { loop: 'float' } }),
      E('shape', { shape: 'star', fill: FILL0({ c1: '#ffe066' }), box: box(1040, 190, 70, 70), anim: { loop: 'spin' } }),
      E('text', { text: name, font: 'poppins', weight: 700, color: '#ffffff', box: box(80, 80, 760, 80, 58), anim: { enter: 'slide-up' } }),
      E('text', { text: 'Novidades toda semana. Peça pelo carrinho e receba em casa.', color: '#ffeaf3', box: box(80, 170, 700, 50, 21), anim: { enter: 'fade', delay: 150 } }),
      E('button', { label: 'Fale com a loja', link: wa(), icon: 'whatsapp', style: 'shine', color: '#ffffff', textColor: '#d6336c', radius: 999, box: box(80, 232, 240, 52, 17), anim: { enter: 'zoom-in', delay: 300 } }),
    ];
  } else if (key === 'catalog-minimal') {
    doc.theme = { ...th, ...preset('oceano'), bg: '#f8fafc', headingFont: 'montserrat' };
    doc.seo = { title: `${name} — Loja`, description: `Conheça o catálogo de ${name} e faça seu pedido.` };
    doc.catalog.cartLayout = 'compact';
    doc.heights.desktop = 240;
    doc.elements = [
      E('shape', { shape: 'rect', radius: 20, fill: FILL0({ c1: '#ffffff' }), shadow: 'small', box: box(48, 32, 1104, 176) }),
      E('text', { text: name, font: 'montserrat', weight: 700, color: '#14202e', box: box(100, 72, 650, 58, 42), anim: { enter: 'slide-up' } }),
      E('text', { text: 'Escolhas especiais, com toda a praticidade de comprar online.', color: '#526173', box: box(100, 138, 680, 34, 18), anim: { enter: 'fade', delay: 120 } }),
      E('button', { label: 'Ver carrinho', link: url(), icon: 'cart', style: 'solid', radius: 999, box: box(850, 92, 230, 58, 17), anim: { enter: 'zoom-in', delay: 180 } }),
    ];
  } else if (key === 'catalog-editorial') {
    doc.theme = { ...th, primary: '#bb8a55', bg: '#f6f0e8', text: '#25231f', headingFont: 'playfair' };
    doc.seo = { title: `${name} — Coleção`, description: `Explore a coleção de ${name} e monte seu pedido.` };
    doc.catalog.cartLayout = 'split';
    doc.heights.desktop = 300;
    doc.elements = [
      E('shape', { shape: 'rect', fill: FILL0({ type: 'gradient', c1: '#24241f', c2: '#424033', angle: 120 }), box: box(0, 0, 1200, 300) }),
      E('shape', { shape: 'ring', radius: 18, fill: FILL0({ c1: '#bb8a55' }), opacity: 60, box: box(900, 40, 200, 200), anim: { loop: 'float' } }),
      E('text', { text: 'A CURADORIA', color: '#d8b88f', weight: 700, spacing: 4, box: box(90, 64, 400, 28, 15), anim: { enter: 'fade' } }),
      E('text', { text: name, font: 'playfair', weight: 700, color: '#fffaf2', box: box(90, 105, 690, 74, 52), anim: { enter: 'slide-up', delay: 100 } }),
      E('text', { text: 'Peças selecionadas para tornar cada escolha especial.', color: '#eee5d9', box: box(92, 196, 620, 44, 19), anim: { enter: 'fade', delay: 200 } }),
      E('button', { label: 'Abrir sacola', link: url(), icon: 'bag', style: 'outline', color: '#f6f0e8', textColor: '#f6f0e8', radius: 999, box: box(840, 112, 245, 58, 17), anim: { enter: 'zoom-in', delay: 260 } }),
    ];
  }
  return key === 'blank' ? doc : finish(doc, key);
}
