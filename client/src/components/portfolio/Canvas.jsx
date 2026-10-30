import { cloneElement, isValidElement, memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './pv.css';
import { DESIGN_W, autoHeight, boxOf, layoutBoxes, pageHeight, setCatalogContext } from '../../lib/portfolio/doc.js';
import { CatalogScope, CatGridView, CatSearchView } from './Catalog.jsx';
import { ICON_COMPONENTS, ICONS } from '../../lib/portfolio/icons.js';
import { CLIP_IDS, SHAPE_PATHS, clipId } from '../../lib/portfolio/shapes.js';
import { fontCss, linkHref, parseVideo, readableOn } from '../../lib/portfolio/model.js';
import { brl } from '../../lib/format.js';

// Desenha a página do portfólio (formato v2). O mesmo código serve ao editor, à visualização e à página pública:
//  mode 'edit'   → ferramentas de edição, links desligados, imagens vazias mostram um espaço reservado
//  mode 'public' → links funcionam, o que está vazio não aparece
// `animate`: liga as animações de entrada e as contínuas (na página pública sempre; no editor só ao clicar em "Testar animações").

// ---------------------------------------------------------------- escala por tamanho de tela
export function usePageScale() {
  const read = () => document.documentElement.clientWidth || window.innerWidth;
  const [w, setW] = useState(read);
  useEffect(() => {
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setW(read())); };
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('resize', on); cancelAnimationFrame(raf); };
  }, []);
  const device = w <= 600 ? 'mobile' : w <= 1024 ? 'tablet' : 'desktop';
  const designW = DESIGN_W[device];
  return { device, designW, width: w, scale: device === 'desktop' ? Math.min(1, w / designW) : w / designW };
}

// ---------------------------------------------------------------- cores e efeitos
export const fillBackground = (f) => (f.type === 'gradient' ? `linear-gradient(${f.angle}deg, ${f.c1}, ${f.c2})` : f.c1);
export const fillClass = (f) => (f.animate === 'flow' && f.type === 'gradient' ? 'fa-flow' : f.animate === 'hue' ? 'fa-hue' : f.animate === 'shimmer' ? 'fa-shimmer' : '');

// ---------------------------------------------------------------- entrar na tela (animação de entrada)
const watchers = new WeakMap();
let observer = null;
function watch(node, cb) {
  if (typeof IntersectionObserver === 'undefined') { cb(); return () => {}; }
  observer = observer || new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { watchers.get(e.target)?.(); observer.unobserve(e.target); watchers.delete(e.target); }
  }, { threshold: 0.12 });
  watchers.set(node, cb);
  observer.observe(node);
  return () => { observer?.unobserve(node); watchers.delete(node); };
}

// ---------------------------------------------------------------- recortes (formas e máscaras)
export function ClipDefs() {
  return (
    <svg className="pv-clips" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {CLIP_IDS.map((s) => (
          <clipPath key={s} id={clipId(s, 'pv')} clipPathUnits="objectBoundingBox"><path d={SHAPE_PATHS[s]} /></clipPath>
        ))}
      </defs>
    </svg>
  );
}

function Outline({ shape, w, color, style }) {
  if (!w) return null;
  const dash = style === 'dashed' ? `${w * 3} ${w * 2}` : style === 'dotted' ? `0.01 ${w * 2}` : undefined;
  return (
    <svg className="pv-outline" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
      <path d={SHAPE_PATHS[shape]} fill="none" stroke={color} strokeWidth={w} vectorEffect="non-scaling-stroke" strokeDasharray={dash} strokeLinecap={style === 'dotted' ? 'round' : 'butt'} strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------- ícone
export function IconSvg({ name, size = '1em', color = 'currentColor', sw = 2 }) {
  const ic = ICONS[name] || ICONS.star;
  const IconComponent = ICON_COMPONENTS[name];
  if (IconComponent) return <IconComponent size={size} color={color} aria-hidden="true" focusable="false" />;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {(ic.s || []).map((d, i) => <path key={`s${i}`} d={d} />)}
      {(ic.f || []).map((d, i) => <path key={`f${i}`} d={d} fill={color} stroke="none" />)}
    </svg>
  );
}

// ---------------------------------------------------------------- tipos de elemento
const VALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };

function TextView({ el, box }) {
  const grad = el.useFill;
  const neon = el.shadow === 'neon';
  const col = neon ? (el.shadowColor || el.color) : el.color;
  const shadow = el.shadow === 'soft' ? '0 2px 10px rgba(0,0,0,.35)' : el.shadow === 'hard' ? `3px 3px 0 ${el.shadowColor}` : neon ? `0 0 6px ${col}, 0 0 16px ${col}, 0 0 32px ${col}` : undefined;
  const style = {
    fontFamily: fontCss(el.font), fontWeight: el.weight, fontStyle: el.italic ? 'italic' : 'normal', textDecoration: el.underline ? 'underline' : 'none',
    textTransform: el.upper ? 'uppercase' : 'none', textAlign: el.align, color: el.color, lineHeight: el.lineHeight, letterSpacing: `${el.spacing}px`,
    fontSize: box.fs, justifyContent: VALIGN[el.valign] || 'flex-start', textShadow: grad ? undefined : shadow,
  };
  const spanStyle = grad ? { background: fillBackground(el.fill) } : undefined;
  return (
    <div className={`pv-text${grad ? ' is-grad' : ''}`} style={style}>
      <span className={grad ? fillClass(el.fill) : ''} style={spanStyle}>{el.text}</span>
    </div>
  );
}

function ImageView({ el, mode }) {
  if (!el.src) return mode === 'edit' ? <div className="pv-ph"><span>Clique duas vezes para escolher uma imagem</span></div> : null;
  const f = el.filters;
  const filter = [
    f.brightness !== 100 && `brightness(${f.brightness}%)`, f.contrast !== 100 && `contrast(${f.contrast}%)`, f.saturate !== 100 && `saturate(${f.saturate}%)`,
    f.grayscale && `grayscale(${f.grayscale}%)`, f.sepia && `sepia(${f.sepia}%)`, f.hue && `hue-rotate(${f.hue}deg)`, f.blur && `blur(${f.blur}px)`,
  ].filter(Boolean).join(' ');
  const masked = !['none', 'rounded'].includes(el.mask);
  const wrapStyle = {
    borderRadius: el.mask === 'rounded' ? '24%' : masked ? 0 : el.radius,
    border: !masked && el.borderW ? `${el.borderW}px solid ${el.borderColor}` : undefined,
    clipPath: masked ? `url(#${clipId(el.mask, 'pv')})` : undefined, opacity: el.opacity / 100,
  };
  const imgStyle = {
    objectFit: el.fit, objectPosition: `${el.px}% ${el.py}%`, filter: filter || undefined,
    transform: `scale(${el.zoom * (el.flipX ? -1 : 1)}, ${el.zoom * (el.flipY ? -1 : 1)})`, transformOrigin: `${el.px}% ${el.py}%`,
  };
  return (
    <div className={masked && el.shadow !== 'none' ? `ds-${el.shadow}` : ''} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div className={`pv-img${!masked && el.shadow !== 'none' ? ` sh-${el.shadow}` : ''}`} style={wrapStyle}>
        <img src={el.src} alt={el.alt || ''} draggable={false} decoding="async" loading={undefined} style={imgStyle} />
      </div>
      {masked && <Outline shape={el.mask} w={el.borderW} color={el.borderColor} />}
    </div>
  );
}

function IconView({ el, box, cartCount }) {
  const s = Math.min(box.w, box.h);
  const bgRadius = el.bg === 'circle' ? '50%' : el.bg === 'rounded' ? '24%' : 0;
  return (
    <div className={`pv-icon${el.shadow !== 'none' && el.bg !== 'none' ? ` sh-${el.shadow}` : ''}`}
      style={{ background: el.bg === 'none' ? 'transparent' : el.bgColor, borderRadius: bgRadius, border: el.bg !== 'none' && el.borderW ? `${el.borderW}px solid ${el.borderColor}` : undefined, '--gc': el.bgColor }}>
      {['cart', 'bag'].includes(el.name) ? <CartGlyph name={el.name} size={el.bg === 'none' ? s : s * 0.56} count={cartCount} /> : <IconSvg name={el.name} size={el.bg === 'none' ? s : s * 0.56} color={el.color} />}
    </div>
  );
}

function ShapeView({ el }) {
  const f = el.fill;
  const bg = { background: fillBackground(f) };
  const dash = el.borderStyle;
  const base = `pv-fillbox ${fillClass(f)}`;
  let inner;
  if (el.shape === 'rect' || el.shape === 'line') {
    inner = <div className={base} style={{ ...bg, borderRadius: el.shape === 'line' ? 999 : el.radius, border: el.borderW ? `${el.borderW}px ${dash} ${el.borderColor}` : undefined, boxSizing: 'border-box' }} />;
  } else if (el.shape === 'ring') {
    const t = el.radius > 0 ? el.radius : 20;
    const mask = `radial-gradient(farthest-side, transparent calc(100% - ${t}px), #000 calc(100% - ${t}px + 1px))`;
    inner = <div className={base} style={{ ...bg, borderRadius: '50%', WebkitMaskImage: mask, maskImage: mask }} />;
  } else {
    inner = (
      <>
        <div className={base} style={{ ...bg, clipPath: `url(#${clipId(el.shape, 'pv')})` }} />
        <Outline shape={el.shape} w={el.borderW} color={el.borderColor} style={dash} />
      </>
    );
  }
  const clipped = !['rect', 'line'].includes(el.shape);
  return (
    <div className={`pv-shape${el.shadow !== 'none' ? (clipped ? ` ds-${el.shadow}` : ` sh-${el.shadow}`) : ''}`} style={{ opacity: el.opacity / 100, '--gc': f.c1, borderRadius: el.shape === 'rect' ? el.radius : undefined }}>
      {inner}
    </div>
  );
}

function CartGlyph({ name, size, count = 0 }) {
  return <span className="pv-cart-glyph"><IconSvg name={name} size={size} />{count > 0 && <i aria-label={`${count} itens no carrinho`}>{count > 99 ? '99+' : count}</i>}</span>;
}

function ButtonView({ el, box, mode, onCart, onLink, cartCount }) {
  const href = linkHref(el.link);
  const style = {
    '--c1': el.color, '--c2': el.color2, '--tc': el.textColor || readableOn(el.color), '--rad': `${el.radius}px`,
    fontFamily: fontCss(el.font), fontWeight: el.weight, fontSize: box.fs,
  };
  const Icon = el.icon ? (['cart', 'bag'].includes(el.icon) ? <CartGlyph name={el.icon} size="1.15em" count={cartCount} /> : <IconSvg name={el.icon} size="1.15em" />) : null;
  const cls = `pv-btn is-${el.style}${mode === 'edit' && !href ? ' is-nolink' : ''}`;
  const body = <>{el.iconPos !== 'right' && Icon}<span>{el.label || 'Botão'}</span>{el.iconPos === 'right' && Icon}</>;
  const opensCart = mode === 'public' && onCart && ['cart', 'bag'].includes(el.icon);
  const button = opensCart
    ? <button type="button" className={cls} style={style} onClick={() => { onCart(); onLink?.(el); }}>{body}</button>
    : null;
  return { cls, style, body, href, button };
}

function CarouselView({ el, mode }) {
  const slides = el.slides || [];
  const [i, setI] = useState(0);
  const n = slides.length;
  const cur = n ? i % n : 0;
  useEffect(() => {
    if (mode !== 'public' || !el.autoplay || n < 2) return undefined;
    const t = setInterval(() => setI((v) => (v + 1) % n), Math.max(2, el.interval) * 1000);
    return () => clearInterval(t);
  }, [mode, el.autoplay, el.interval, n]);
  if (!n) return mode === 'edit' ? <div className="pv-ph"><span>Adicione as imagens do carrossel no painel</span></div> : null;
  const go = (d) => setI((cur + d + n) % n);
  return (
    <div className="pv-car" style={{ borderRadius: el.radius }}>
      <div className="pv-car-track" style={{ transform: `translateX(-${cur * 100}%)` }}>
        {slides.map((s) => {
          const href = mode === 'public' ? linkHref(s.link) : '';
          const img = <img src={s.src} alt={s.alt || ''} draggable="false" style={{ objectFit: el.fit }} />;
          return <div className="pv-car-slide" key={s.id}>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{img}</a> : img}</div>;
        })}
      </div>
      {el.arrows && n > 1 && (
        <>
          <button type="button" className="pv-car-btn is-prev" aria-label="Anterior" onClick={() => go(-1)}>‹</button>
          <button type="button" className="pv-car-btn is-next" aria-label="Próxima" onClick={() => go(1)}>›</button>
        </>
      )}
      {el.dots && n > 1 && (
        <div className="pv-car-dots">
          {slides.map((s, k) => <button type="button" key={s.id} className={k === cur ? 'is-on' : ''} aria-label={`Imagem ${k + 1}`} onClick={() => setI(k)} />)}
        </div>
      )}
    </div>
  );
}

function MenuView({ el, device, mode }) {
  const [open, setOpen] = useState(false);
  const items = el.items || [];
  const burger = el.variant === 'hamburger' || (el.variant === 'auto' && device === 'mobile');
  const style = { '--mc': el.color, '--mbg': el.bg, '--mr': `${el.radius}px` };
  const link = (it) => {
    const href = mode === 'public' ? linkHref(it.link) : '';
    return href
      ? <a key={it.id} href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer" onClick={() => setOpen(false)}>{it.label}</a>
      : <span key={it.id}>{it.label}</span>;
  };
  if (!burger) return <nav className="pv-menu is-bar" style={style} aria-label={el.title || 'Menu'}>{items.map(link)}</nav>;
  return (
    <div className={`pv-menu is-burger${open ? ' is-open' : ''}`} style={style}>
      <button type="button" className="pv-menu-btn" aria-expanded={open} aria-label="Abrir menu" onClick={() => setOpen((v) => !v)}>
        <span className="pv-bars" aria-hidden="true"><i /><i /><i /></span>
        {el.title && <b>{el.title}</b>}
      </button>
      {open && <nav className="pv-menu-panel" aria-label={el.title || 'Menu'}>{items.map(link)}</nav>}
    </div>
  );
}

function ModalToolView({ el, mode, shop, onCart }) {
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const steps = el.steps?.length ? el.steps : [{ title: 'Etapa 1', content: '' }];
  const step = steps[stepIndex] || steps[0];
  const answerText = useMemo(() => steps.flatMap((item) => (item.questions || []).map((question) => {
    const value = answers[question.id];
    const answer = Array.isArray(value) ? value.join(', ') : value;
    return answer ? `${question.label}: ${answer}` : '';
  })).filter(Boolean).join('\n'), [answers, steps]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  function continueStep() {
    if (!validateStep()) return;
    setError('');
    if (stepIndex < steps.length - 1) setStepIndex((index) => index + 1);
    else {
      if (el.actionType === 'cart') {
        if (!shop?.cart || !el.actionProductId || !onCart) {
          setError('O carrinho não está disponível nesta página. Verifique o produto e o tipo de catálogo.');
          return;
        }
        shop.cart.add(el.actionProductId, null, null, 1);
        try { localStorage.setItem(`dm:modal-result:${shop.slug}`, answerText); } catch { /* O resultado continua visível neste modal. */ }
        onCart();
        setResult('Produto adicionado ao carrinho. Suas respostas serão incluídas nas observações do pedido.');
      } else setResult(answerText || 'Concluído.');
    }
  }
  function validateStep() {
    const missing = (step.questions || []).find((question) => question.required
      && !(Array.isArray(answers[question.id]) ? answers[question.id].length : String(answers[question.id] || '').trim()));
    if (!missing) return true;
    setError(`Responda: ${missing.label || 'a pergunta obrigatória'}.`);
    return false;
  }
  function start() {
    setStepIndex(0);
    setAnswers({});
    setError('');
    setResult('');
    setOpen(true);
  }
  const whatsappPhone = String(el.actionPhone || shop?.whatsapp || '').replace(/\D/g, '');
  const normalizedPhone = whatsappPhone.length === 10 || whatsappPhone.length === 11 ? `55${whatsappPhone}` : whatsappPhone;
  const whatsappUrl = /^55\d{10,11}$/.test(normalizedPhone)
    ? `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(`${el.title}\n${answerText}`)}`
    : '';
  const linkUrl = (() => {
    if (el.actionType !== 'link' || !el.actionUrl) return '';
    try {
      const target = new URL(el.actionUrl);
      target.searchParams.set('result', answerText);
      return target.toString();
    } catch { return ''; }
  })();
  function setAnswer(question, value) {
    setAnswers((current) => ({ ...current, [question.id]: value }));
  }
  return (
    <>
      <button type="button" className="pv-modal-trigger" onClick={mode === 'public' ? start : undefined}>{el.trigger}</button>
      {open && createPortal(
        <div className="pv-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="pv-modal" role="dialog" aria-modal="true" aria-labelledby={`pv-modal-title-${el.id}`}>
            <button type="button" className="pv-modal-close" onClick={() => setOpen(false)} aria-label="Fechar">×</button>
            <h2 id={`pv-modal-title-${el.id}`}>{el.title}</h2>
            {result ? (
              <>
                <p className="pv-modal-result">{result}</p>
                {answerText && <pre className="pv-modal-content">{answerText}</pre>}
                <button type="button" className="pv-modal-primary" onClick={() => setOpen(false)}>Concluir</button>
              </>
            ) : <>
              <div className="pv-modal-progress" aria-label={`Etapa ${stepIndex + 1} de ${steps.length}`}>Etapa {stepIndex + 1} de {steps.length}</div>
              <h3>{step.title}</h3>
              {step.image && <img className="pv-modal-image" src={step.image} alt="" />}
              {step.content && <p className="pv-modal-content">{step.content}</p>}
              <div className="pv-modal-questions">
                {(step.questions || []).map((question) => {
                  const value = answers[question.id] ?? (question.type === 'multiselect' ? [] : '');
                  return (
                    <div className="pv-modal-question" key={question.id}>
                      <span>{question.label}{question.required ? ' *' : ''}</span>
                      {question.type === 'textarea'
                        ? <textarea value={value} onChange={(event) => setAnswer(question, event.target.value)} />
                        : question.type === 'select'
                          ? <select value={value} onChange={(event) => setAnswer(question, event.target.value)}>
                            <option value="">Selecione...</option>{(question.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                          : question.type === 'multiselect'
                            ? <span className="pv-modal-options">{(question.options || []).map((option) => (
                              <label key={option}><input type="checkbox" checked={value.includes(option)} onChange={(event) => setAnswer(question, event.target.checked ? [...value, option] : value.filter((item) => item !== option))} />{option}</label>
                            ))}</span>
                            : <input value={value} onChange={(event) => setAnswer(question, event.target.value)} />}
                    </div>
                  );
                })}
              </div>
              {error && <p className="pv-modal-error" role="alert">{error}</p>}
              <div className="pv-modal-actions">
                {stepIndex > 0 && <button type="button" className="pv-modal-secondary" onClick={() => { setError(''); setStepIndex((index) => index - 1); }}>Voltar</button>}
                {stepIndex < steps.length - 1
                  ? <button type="button" className="pv-modal-primary" onClick={continueStep}>Continuar</button>
                  : el.actionType === 'whatsapp'
                    ? <a className="pv-modal-primary" href={whatsappUrl || undefined} target="_blank" rel="noopener noreferrer" onClick={(event) => { if (!validateStep()) event.preventDefault(); else if (!whatsappUrl) { event.preventDefault(); setError('Informe um WhatsApp válido para enviar as respostas.'); } }}>{el.actionLabel || 'Enviar respostas'}</a>
                    : el.actionType === 'link'
                    ? <a className="pv-modal-primary" href={linkUrl || undefined} target="_blank" rel="noopener noreferrer" onClick={(event) => { if (!validateStep()) event.preventDefault(); else if (!linkUrl) { event.preventDefault(); setError('Informe um link http(s) para enviar as respostas.'); } }}>{el.actionLabel || 'Continuar'}</a>
                      : <button type="button" className="pv-modal-primary" onClick={continueStep}>{el.actionType === 'cart' ? el.actionLabel || 'Adicionar ao carrinho' : 'Concluir'}</button>}
              </div>
            </>}
          </section>
        </div>,
        document.body,
        `modal-${el.id}`,
      )}
    </>
  );
}

function CustomCodeView({ el, mode }) {
  const src = useMemo(() => {
    const code = (el.code || '').replace(/\snonce\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; script-src-attr 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;min-height:100%;font-family:system-ui,sans-serif}body{overflow:auto}</style></head><body>${code}</body></html>`;
    const bytes = new TextEncoder().encode(html);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return `data:text/html;charset=utf-8;base64,${btoa(binary)}`;
  }, [el.code]);
  return <iframe className="pv-custom-frame" title="Conteúdo personalizado" sandbox="allow-scripts allow-modals allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" src={src} style={mode === 'edit' ? { pointerEvents: 'none' } : undefined} />;
}

function VideoView({ el, mode }) {
  const v = el.url ? parseVideo(el.url) : null;
  if (!v) return mode === 'edit' ? <div className="pv-ph"><span>Cole o link de um vídeo (YouTube ou Vimeo) no painel</span></div> : null;
  return (
    <div className="pv-video" style={{ borderRadius: el.radius }}>
      {v.kind === 'file'
        ? <video src={v.src} controls playsInline preload="metadata" style={mode === 'edit' ? { pointerEvents: 'none' } : undefined} />
        : <iframe src={v.src} title="Vídeo" loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" style={mode === 'edit' ? { pointerEvents: 'none' } : undefined}
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" />}
    </div>
  );
}

export function ProductCard({ p, cardStyle = 'soft', price = true, action, card }) {
  const k = card || { layout: 'vertical', ratio: 'square', fit: 'cover', align: 'left', radius: 14, showImage: true, showCategory: true, showName: true, showDescription: false, showPrice: true, showTiers: false, showVariations: true, showButton: true };
  const img = p.mainImage || p.images[0];
  const tiers = [...(p.priceOptions || [])].filter((option) => option.priceCents !== null);
  const tierThreshold = (option) => option.scope === 'cart_value'
    ? `a partir de ${brl(option.minCartCents || 0)} no carrinho`
    : `a partir de ${option.minQuantity || 1} ${option.scope === 'cart_quantity' ? 'peças no carrinho' : 'un.'}`;
  const imagePrice = (p.images || []).filter((image) => image.priceCents !== null).sort((a, b) => a.priceCents - b.priceCents)[0];
  const displayedPrice = p.priceCents > 0
    ? { cents: p.priceCents, label: '' }
    : imagePrice
      ? { cents: imagePrice.priceCents, label: k.priceFrom === false ? '' : 'a partir de ' }
      : tiers.length
        ? { cents: Math.min(...tiers.map((option) => option.priceCents)), label: k.priceFrom === false ? '' : 'a partir de ' }
        : null;
  const style = {
    '--card-r': `${k.radius}px`,
    ...(k.bg ? { background: k.bg } : {}), ...(k.text ? { color: k.text } : {}), ...(k.accent ? { '--p': k.accent } : {}),
    ...(k.font ? { fontFamily: fontCss(k.font) } : {}),
    '--nl': k.nameLines || 2,
    ...(k.ratio === 'custom' ? { '--img-h': `${k.imgHeight || 180}px` } : {}),
  };
  const mods = [k.shadow && `sh-${k.shadow}`, k.border && 'has-border', k.padding && `pad-${k.padding}`, k.textSize && `ts-${k.textSize}`, k.priceSize && `ps-${k.priceSize}`, k.buttonStyle && `bt-${k.buttonStyle}`, k.buttonFull === false && 'bt-auto'].filter(Boolean).join(' ');
  const iconNode = k.icon ? <span className="pv-card-ico" style={k.iconColor ? { color: k.iconColor } : undefined}><IconSvg name={k.icon} size="1.1em" /></span> : null;
  const iconAt = (pos) => (k.icon && (k.iconPos || 'button') === pos ? iconNode : null);
  const actionNode = action && iconAt('button') && isValidElement(action)
    ? cloneElement(action, {}, iconNode, action.props.children)
    : action;
  const imgStyle = {
    objectPosition: `${k.imgX ?? 50}% ${k.imgY ?? 50}%`,
    ...(k.imgPad ? { padding: k.imgPad, boxSizing: 'border-box' } : {}),
  };
  return (
    <div className={`pv-card cs-${cardStyle} is-${k.layout} ratio-${k.ratio} fit-${k.fit} al-${k.align} ${mods}`} style={style}>
      {k.showImage && (
        <div className="pv-card-img" style={k.imgBg ? { background: k.imgBg } : undefined}>
          {img && <img src={img.url} alt={p.name} loading="lazy" decoding="async" style={imgStyle} />}
          {iconAt('corner') && <span className="pv-card-corner">{iconNode}</span>}
          {k.showVariations && p.images.length > 0 && <span className="pv-dots" aria-hidden="true">{p.images.map((i) => <i key={i.id} />)}</span>}
        </div>
      )}
      <div className="pv-card-body">
        {k.showCategory && <span className="pv-card-cat">{p.category}</span>}
        {k.showName && <span className="pv-card-name">{iconAt('name')}{p.name}</span>}
        {k.showDescription && p.description && <span className="pv-card-desc">{p.description}</span>}
        {price && k.showPrice && displayedPrice && <span className="pv-card-price">{displayedPrice.label}{brl(displayedPrice.cents)}</span>}
        {k.showTiers && tiers.length > 0 && <span className="pv-card-tiers">{tiers.map((t) => <small key={t.id}>{t.label}: {brl(t.priceCents)} {tierThreshold(t)}</small>)}</span>}
        {k.showVariations && p.images.length > 0 && <span className="pv-card-vars">{p.images.map((i) => <small key={i.id}>{i.label}</small>)}</span>}
        {k.showButton && actionNode}
      </div>
    </div>
  );
}

export const minPrice = (p) => {
  const values = [
    ...(p.priceCents > 0 ? [p.priceCents] : []),
    ...(p.images || []).filter((i) => i.priceCents !== null).map((i) => i.priceCents),
    ...(p.priceOptions || []).filter((option) => option.priceCents !== null).map((option) => option.priceCents),
  ];
  return values.length ? Math.min(...values) : 0;
};

function ProductsView({ el, device, products, mode }) {
  const list = el.ids.map((id) => (products || []).find((p) => p.id === id)).filter(Boolean);
  if (!list.length) return mode === 'edit' ? <div className="pv-ph"><span>Escolha os produtos no painel ao lado</span></div> : null;
  const cols = el.cols[device] || 3;
  const wa = el.whatsapp ? (p) => `https://wa.me/${el.whatsapp}?text=${encodeURIComponent(`Olá! Tenho interesse em: ${p.name}`)}` : null;
  return (
    <div className="pv-products" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {list.map((p) => (
        <ProductCard key={p.id} p={p} cardStyle={el.cardStyle} price={el.showPrice}
          action={wa && (mode === 'edit'
            ? <span className="pv-card-btn">{el.buttonLabel}</span>
            : <a className="pv-card-btn" href={wa(p)} target="_blank" rel="noopener noreferrer">{el.buttonLabel}</a>)} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- elemento completo (posição, animações, link)
const FULL_BLEED = 3000; // elementos de largura total passam das bordas do desenho; a página corta o excesso
function ElementViewBase({ el, device, mode, animate, products, shop, z, onLink, onCart, cartCount, replay = 0, layoutBox, fixedStyle }) {
  const box = layoutBox || boxOf(el, device);
  const ref = useRef(null);
  const a = el.anim;
  const hasEnter = animate && a.enter !== 'none';
  const [seen, setSeen] = useState(!hasEnter);
  useEffect(() => {
    if (!hasEnter) { setSeen(true); return undefined; }
    setSeen(false);
    const node = ref.current;
    return node ? watch(node, () => setSeen(true)) : undefined;
  }, [hasEnter, replay, a.enter]);

  if (box.hide && mode === 'public') return null;
  if (mode === 'public' && el.t === 'image' && !el.src) return null;

  let content;
  let linked = null;
  if (el.t === 'text') { content = <TextView el={el} box={box} />; linked = el.link; }
  else if (el.t === 'image') { content = <ImageView el={el} mode={mode} />; linked = el.link; }
  else if (el.t === 'icon') {
    content = <IconView el={el} box={box} cartCount={cartCount} />;
    if (mode === 'public' && onCart && el.scrollAction === 'none' && ['cart', 'bag'].includes(el.name)) {
      content = <button type="button" className="pv-icon-cart-action" onClick={() => onCart()} aria-label="Abrir carrinho">{content}</button>;
    } else linked = el.link;
  }
  else if (el.t === 'shape') { content = <ShapeView el={el} />; linked = el.link; }
  else if (el.t === 'spacer') content = <ShapeView el={{ ...el, shape: 'rect', radius: 0, borderStyle: 'solid' }} />;
  else if (el.t === 'video') content = <VideoView el={el} mode={mode} />;
  else if (el.t === 'carousel') content = <CarouselView el={el} mode={mode} />;
  else if (el.t === 'menu') content = <MenuView el={el} device={device} mode={mode} />;
  else if (el.t === 'products') content = <ProductsView el={el} device={device} products={products} mode={mode} />;
  else if (el.t === 'modal') content = <ModalToolView el={el} mode={mode} shop={shop} onCart={onCart} />;
  else if (el.t === 'custom') content = <CustomCodeView el={el} mode={mode} />;
  else if (el.t === 'catsearch') content = <CatSearchView el={el} mode={mode} />;
  else if (el.t === 'catgrid') content = <CatGridView el={el} device={device} mode={mode} />;
  else if (el.t === 'button') {
    const b = ButtonView({ el, box, mode, onCart, onLink, cartCount });
    if (mode === 'public' && !b.href && !b.button) return null; // botão sem link não aparece na página pública
    content = mode === 'public'
      ? b.button || <a className={b.cls} style={b.style} href={b.href} target="_blank" rel="noopener noreferrer" onClick={() => onLink?.(el)}>{b.body}</a>
      : <div className={b.cls} style={b.style}>{b.body}</div>;
  }
  if (content == null) return null;

  const href = linked && mode === 'public' ? linkHref(linked) : '';
  if (mode === 'public' && el.scrollAction && el.scrollAction !== 'none') {
    const top = el.scrollAction === 'top';
    content = <button type="button" className="pv-scroll-action" aria-label={top ? 'Voltar ao topo' : 'Ir para o fim da página'} onClick={() => window.scrollTo({ top: top ? 0 : document.documentElement.scrollHeight, behavior: 'smooth' })}>{content}</button>;
  } else if (href) content = <a className="pv-link" href={href} target="_blank" rel="noopener noreferrer" onClick={() => onLink?.(el)}>{content}</a>;

  const bleed = el.full && (el.t === 'shape' || el.t === 'spacer') && (el.shape || 'rect') === 'rect';
  const style = fixedStyle
    ? { ...fixedStyle, width: box.w, height: box.h, zIndex: z + 1000 }
    : bleed
    ? { left: -FULL_BLEED, top: box.y, width: DESIGN_W[device] + FULL_BLEED * 2, height: box.h, zIndex: z }
    : { left: box.x, top: box.y, width: box.w, height: el.t === 'products' ? 'auto' : box.h, zIndex: z, transform: box.r ? `rotate(${box.r}deg)` : undefined };
  const element = (
    <div ref={ref} className={`pv-el pv-t-${el.t}${box.hide ? ' is-ghost' : ''}`} data-el={el.id} style={style}>
      <div className={`pv-enter${hasEnter ? ` has-enter e-${a.enter}${seen ? ' is-in' : ''}` : ''}`} style={{ '--dur': `${a.duration}ms`, '--delay': `${a.delay}ms` }}>
        <div className={`pv-loop${animate && a.loop !== 'none' ? ` l-${a.loop}` : ''}`}>
          <div className={`pv-hover${a.hover !== 'none' && mode === 'public' ? ` h-${a.hover}` : ''}`}>
            <div className="pv-body">{content}</div>
          </div>
        </div>
      </div>
    </div>
  );
  return fixedStyle ? createPortal(element, document.body, `fixed-${el.id}`) : element;
}

export const ElementView = memo(ElementViewBase);

// ---------------------------------------------------------------- página
export function PageBackground({ theme }) {
  const grad = theme.bgType === 'gradient';
  const fx = grad && theme.bgAnimate === 'flow' ? 'fa-flow' : theme.bgAnimate === 'hue' ? 'fa-hue' : '';
  return <div className={`pv-bg ${fx}`} style={{ background: grad ? `linear-gradient(${theme.bgAngle}deg, ${theme.bg}, ${theme.bgColor2})` : theme.bg }} />;
}

// Rodapé pequeno e discreto, igual em toda página publicada.
export function PageCredit({ theme }) {
  return (
    <footer className="pv-credit" style={{ '--credit': readableOn(theme.bg) }}>
      <span>Desenvolvido por <a href="https://www.agenciadmdigital.com.br/" target="_blank" rel="noopener">Solução DM</a></span>
      <span className="sep" aria-hidden="true">·</span>
      <a href="https://agenciadmdigital.com.br" target="_blank" rel="noopener">agenciadmdigital.com.br</a>
    </footer>
  );
}

// A área livre da página (elementos posicionados). `children` entra por cima dos elementos (alças de edição).
export default function PortfolioCanvas({ doc, device, scale = 1, mode = 'public', animate = true, products, shop, onLink, onCart, cartCount = 0, replay = 0, children, minHeight, viewportFixed = true }) {
  setCatalogContext(products, doc.catalog);
  const W = DESIGN_W[device];
  const H = Math.max(minHeight || 0, pageHeight(doc, device, products, doc.catalog));
  const boxes = layoutBoxes(doc, device, products, doc.catalog);
  const offsetX = typeof window === 'undefined' ? 0 : Math.max(0, (window.innerWidth - W * scale) / 2);
  const themeStyle = {
    '--bg': doc.theme.bg, '--tx': doc.theme.text, '--p': doc.theme.primary, '--on-p': readableOn(doc.theme.primary),
    '--bf': fontCss(doc.theme.bodyFont), '--hf': fontCss(doc.theme.headingFont),
  };
  const body = (
    <div className="pv-fit" style={{ width: W * scale, height: H * scale, flex: 'none' }}>
      <div className="pv-canvas" data-canvas style={{ width: W, height: H, transform: scale === 1 ? undefined : `scale(${scale})` }}>
        {doc.elements.map((el, i) => {
          const box = boxes.get(el.id) || boxOf(el, device, products, doc.catalog);
          const fixed = mode === 'public' && viewportFixed && el.fixed && !box.hide;
          const anchor = el.fixedAnchor || 'bottom-right';
          const fixedStyle = fixed ? {
            position: 'fixed',
            left: anchor.endsWith('left') ? offsetX + box.x * scale : undefined,
            right: anchor.endsWith('right') ? offsetX + box.x * scale : undefined,
            top: anchor.startsWith('top') ? box.y * scale : undefined,
            bottom: anchor.startsWith('bottom') ? box.y * scale : undefined,
            transform: `scale(${scale})${box.r ? ` rotate(${box.r}deg)` : ''}`,
            transformOrigin: `${anchor.startsWith('top') ? 'top' : 'bottom'} ${anchor.endsWith('left') ? 'left' : 'right'}`,
            ...themeStyle,
          } : null;
          return (
            <ElementView key={el.id} el={el} device={device} mode={mode} animate={animate} products={products} shop={shop} z={i + 1}
              onLink={onLink} onCart={onCart} cartCount={cartCount} replay={replay} layoutBox={box} fixedStyle={fixedStyle} />
          );
        })}
        {children}
      </div>
    </div>
  );
  return doc.kind === 'catalog' ? <CatalogScope doc={doc} products={products} shop={shop} mode={mode}>{body}</CatalogScope> : body;
}

// Variáveis de cor e fonte da página (usadas pelo fundo, rodapé, cartões e botões).
export const pvVars = (theme) => ({
  '--bg': theme.bg, '--tx': theme.text, '--p': theme.primary, '--on-p': readableOn(theme.primary), '--bf': fontCss(theme.bodyFont), '--hf': fontCss(theme.headingFont),
});
