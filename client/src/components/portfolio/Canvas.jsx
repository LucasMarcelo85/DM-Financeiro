import { memo, useEffect, useRef, useState } from 'react';
import './pv.css';
import { DESIGN_W, boxOf, pageHeight } from '../../lib/portfolio/doc.js';
import { ICONS } from '../../lib/portfolio/icons.js';
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

function IconView({ el, box }) {
  const s = Math.min(box.w, box.h);
  const bgRadius = el.bg === 'circle' ? '50%' : el.bg === 'rounded' ? '24%' : 0;
  return (
    <div className={`pv-icon${el.shadow !== 'none' && el.bg !== 'none' ? ` sh-${el.shadow}` : ''}`}
      style={{ background: el.bg === 'none' ? 'transparent' : el.bgColor, borderRadius: bgRadius, border: el.bg !== 'none' && el.borderW ? `${el.borderW}px solid ${el.borderColor}` : undefined, '--gc': el.bgColor }}>
      <IconSvg name={el.name} size={el.bg === 'none' ? s : s * 0.56} color={el.color} />
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

function ButtonView({ el, box, mode }) {
  const href = linkHref(el.link);
  const style = {
    '--c1': el.color, '--c2': el.color2, '--tc': el.textColor || readableOn(el.color), '--rad': `${el.radius}px`,
    fontFamily: fontCss(el.font), fontWeight: el.weight, fontSize: box.fs,
  };
  const Icon = el.icon ? <IconSvg name={el.icon} size="1.15em" /> : null;
  const cls = `pv-btn is-${el.style}${mode === 'edit' && !href ? ' is-nolink' : ''}`;
  const body = <>{el.iconPos !== 'right' && Icon}<span>{el.label || 'Botão'}</span>{el.iconPos === 'right' && Icon}</>;
  return { cls, style, body, href };
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

export function ProductCard({ p, cardStyle = 'soft', price = true, action }) {
  const img = p.images[0];
  return (
    <div className={`pv-card cs-${cardStyle}`}>
      <div className="pv-card-img">
        {img && <img src={img.url} alt={p.name} loading="lazy" decoding="async" />}
        {p.images.length > 1 && <span className="pv-dots" aria-hidden="true">{p.images.map((i) => <i key={i.id} />)}</span>}
      </div>
      <div className="pv-card-body">
        <span className="pv-card-cat">{p.category}</span>
        <span className="pv-card-name">{p.name}</span>
        {price && p.priceCents > 0 && <span className="pv-card-price">{p.images.length > 1 && p.images.some((i) => i.priceCents !== null) ? 'a partir de ' : ''}{brl(minPrice(p))}</span>}
        {action}
      </div>
    </div>
  );
}
export const minPrice = (p) => Math.min(p.priceCents, ...p.images.filter((i) => i.priceCents !== null).map((i) => i.priceCents));

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
function ElementViewBase({ el, device, mode, animate, products, z, onLink, replay = 0 }) {
  const box = boxOf(el, device);
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
  else if (el.t === 'icon') { content = <IconView el={el} box={box} />; linked = el.link; }
  else if (el.t === 'shape') { content = <ShapeView el={el} />; linked = el.link; }
  else if (el.t === 'video') content = <VideoView el={el} mode={mode} />;
  else if (el.t === 'products') content = <ProductsView el={el} device={device} products={products} mode={mode} />;
  else if (el.t === 'button') {
    const b = ButtonView({ el, box, mode });
    if (mode === 'public' && !b.href) return null; // botão sem link não aparece na página pública
    content = mode === 'public'
      ? <a className={b.cls} style={b.style} href={b.href} target="_blank" rel="noopener noreferrer" onClick={() => onLink?.(el)}>{b.body}</a>
      : <div className={b.cls} style={b.style}>{b.body}</div>;
  }
  if (content == null) return null;

  const href = linked && mode === 'public' ? linkHref(linked) : '';
  if (href) content = <a className="pv-link" href={href} target="_blank" rel="noopener noreferrer" onClick={() => onLink?.(el)}>{content}</a>;

  const style = {
    left: box.x, top: box.y, width: box.w, height: el.t === 'products' ? 'auto' : box.h, zIndex: z,
    transform: box.r ? `rotate(${box.r}deg)` : undefined,
  };
  return (
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
export default function PortfolioCanvas({ doc, device, scale = 1, mode = 'public', animate = true, products, onLink, replay = 0, children, minHeight }) {
  const W = DESIGN_W[device];
  const H = Math.max(minHeight || 0, pageHeight(doc, device));
  return (
    <div className="pv-fit" style={{ width: W * scale, height: H * scale, flex: 'none' }}>
      <div className="pv-canvas" data-canvas style={{ width: W, height: H, transform: scale === 1 ? undefined : `scale(${scale})` }}>
        {doc.elements.map((el, i) => (
          <ElementView key={el.id} el={el} device={device} mode={mode} animate={animate} products={products} z={i + 1} onLink={onLink} replay={replay} />
        ))}
        {children}
      </div>
    </div>
  );
}

// Variáveis de cor e fonte da página (usadas pelo fundo, rodapé, cartões e botões).
export const pvVars = (theme) => ({
  '--bg': theme.bg, '--tx': theme.text, '--p': theme.primary, '--on-p': readableOn(theme.primary), '--bf': fontCss(theme.bodyFont), '--hf': fontCss(theme.headingFont),
});
