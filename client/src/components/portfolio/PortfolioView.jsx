import { useRef, useState } from 'react';
import EIcon from '../contract/EIcon.jsx';
import { BLOCK_LABELS, DEFAULT_THEME, linkHref, parseVideo, readableOn, themeVars } from '../../lib/portfolio/model.js';

// Desenha a página do portfólio. O mesmo componente serve ao editor (`editing`: seleção, ferramentas, arrastar)
// e à página pública (blocos sem conteúdo somem). Os estilos (.pf-*) usam container queries: a pré-visualização
// "Celular" do editor responde exatamente como a tela de um celular.

function Btn({ label, link, style = 'solid', size = 'md', full, color, theme, editing }) {
  const href = linkHref(link);
  if (!editing && (!href || !label)) return null; // na página pública, botão sem link ou sem texto não aparece
  const bc = color || theme.primary;
  return (
    <a
      className={`pf-btn is-${style}${size === 'lg' ? ' is-lg' : ''}${full ? ' is-full' : ''}${editing && !href ? ' is-nolink' : ''}`}
      style={{ '--bc': bc, '--on-bc': readableOn(bc) }}
      href={href || undefined}
      target="_blank"
      rel="noopener noreferrer"
      onClick={editing ? (e) => e.preventDefault() : undefined}
    >
      {label || 'Botão'}
    </a>
  );
}

const Placeholder = ({ icon, children }) => (
  <div className="pe-ph"><EIcon name={icon} size={26} /><span>{children}</span></div>
);

function Video({ b, editing }) {
  const v = b.url ? parseVideo(b.url) : null;
  if (!v) return editing ? <div className={`pf-media w-${b.width}`}><Placeholder icon="video">Cole o link de um vídeo do YouTube ou Vimeo no painel ao lado</Placeholder></div> : null;
  return (
    <figure className={`pf-media w-${b.width}`}>
      <div className="pf-video">
        {v.kind === 'file'
          ? <video src={v.src} controls playsInline preload="metadata" />
          : <iframe src={v.src} title={b.caption || 'Vídeo'} loading="lazy" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" />}
        {editing && <span className="pe-shield" />}
      </div>
      {b.caption && <figcaption>{b.caption}</figcaption>}
    </figure>
  );
}

function Block({ b, theme, editing }) {
  switch (b.t) {
    case 'banner': {
      const hasBtn = b.showButton && (editing || (b.buttonLabel && linkHref(b.link)));
      return (
        <section className={`pf-b pf-banner bh-${b.height} a-${b.align}`} style={{ background: b.bgColor || theme.primary, color: b.textColor }}>
          {b.image && <img className="pf-banner-img" src={b.image} alt="" decoding="async" />}
          <span className="pf-banner-shade" style={{ background: b.overlayColor, opacity: b.image || b.bgColor ? b.overlay : 0 }} />
          <div className="pf-in pf-banner-in">
            {b.title && <h1>{b.title}</h1>}
            {b.subtitle && <p>{b.subtitle}</p>}
            {hasBtn && <Btn label={b.buttonLabel} link={b.link} theme={{ ...theme, primary: '#ffffff' }} color={readableOn(b.textColor) === '#ffffff' ? '#ffffff' : b.textColor} editing={editing} size="lg" />}
          </div>
        </section>
      );
    }
    case 'logo':
      if (!b.src) return editing ? <section className="pf-b"><div className="pf-in"><Placeholder icon="logo">Logo: escolha a imagem no painel ao lado</Placeholder></div></section> : null;
      return <section className={`pf-b pf-logo a-${b.align}`}><div className="pf-in"><img src={b.src} alt="Logo" style={{ height: b.size }} decoding="async" /></div></section>;
    case 'heading':
      if (!b.text && !editing) return null;
      return <section className="pf-b"><div className="pf-in"><h2 className={`pf-h s-${b.size} a-${b.align}`} style={b.color ? { color: b.color } : undefined}>{b.text || 'Título'}</h2></div></section>;
    case 'text':
      if (!b.text.trim() && !editing) return null;
      return <section className="pf-b"><div className="pf-in"><p className={`pf-p s-${b.size} a-${b.align}`} style={b.color ? { color: b.color } : undefined}>{b.text || 'Texto'}</p></div></section>;
    case 'image':
      if (!b.src) return editing ? <section className="pf-b"><div className="pf-in"><div className={`pf-media w-${b.width}`}><Placeholder icon="image">Imagem: escolha o arquivo no painel ao lado</Placeholder></div></div></section> : null;
      return (
        <section className="pf-b"><div className="pf-in">
          <figure className={`pf-media w-${b.width} a-${b.align}`}>
            <img className={`r-${b.radius}`} src={b.src} alt={b.alt} loading="lazy" decoding="async" />
            {b.caption && <figcaption>{b.caption}</figcaption>}
          </figure>
        </div></section>
      );
    case 'gallery':
      if (!b.items.length) return editing ? <section className="pf-b"><div className="pf-in"><Placeholder icon="gallery">Galeria: adicione imagens no painel ao lado</Placeholder></div></section> : null;
      return (
        <section className="pf-b"><div className="pf-in">
          <div className="pf-gallery" style={{ '--cols': b.cols }}>
            {b.items.map((it) => <img key={it.id} className={`r-${b.radius}`} src={it.src} alt={it.alt} loading="lazy" decoding="async" />)}
          </div>
        </div></section>
      );
    case 'video': {
      const el = <Video b={b} editing={editing} />;
      return el.type && (editing || (b.url && parseVideo(b.url))) ? <section className="pf-b"><div className="pf-in">{el}</div></section> : null;
    }
    case 'button': {
      if (!editing && (!b.label || !linkHref(b.link))) return null;
      return <section className={`pf-b pf-row a-${b.align}`}><div className="pf-in"><Btn label={b.label} link={b.link} style={b.style} size={b.size} full={b.full} color={b.color} theme={theme} editing={editing} /></div></section>;
    }
    case 'divider':
      return <section className="pf-b"><div className="pf-in"><hr className="pf-hr" style={{ borderTopStyle: b.style, borderTopColor: b.color || 'color-mix(in srgb, var(--tx) 25%, transparent)' }} /></div></section>;
    case 'spacer':
      return <div className="pf-b" style={{ height: b.height }} aria-hidden="true" />;
    default:
      return null;
  }
}

export default function PortfolioView({ doc, editing = false, selectedId = null, on = null }) {
  const theme = { ...DEFAULT_THEME, ...doc.theme };
  const dragFrom = useRef(-1);
  const [over, setOver] = useState(-1);
  const last = doc.blocks.length - 1;

  if (!editing) {
    return (
      <div className="pf" style={themeVars(theme)}>
        {doc.blocks.map((b) => <Block key={b.id} b={b} theme={theme} editing={false} />)}
      </div>
    );
  }

  return (
    <div className="pf" style={themeVars(theme)}>
      {doc.blocks.length === 0 && <div className="pe-empty">Sua página está vazia. Use a barra à esquerda para adicionar banner, textos, imagens, vídeo e botões.</div>}
      {doc.blocks.map((b, i) => {
        const sel = b.id === selectedId;
        return (
          <div
            key={b.id}
            className={`pe-blk${sel ? ' is-sel' : ''}${over === i ? ' is-over' : ''}`}
            data-block={b.id}
            tabIndex={0}
            role="button"
            aria-label={`${BLOCK_LABELS[b.t]}${sel ? ' (selecionado)' : ''}`}
            onClick={(e) => { e.stopPropagation(); on.select(b.id); }}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); on.select(b.id); } }}
            onDragOver={(e) => { if (dragFrom.current >= 0) { e.preventDefault(); setOver(i); } }}
            onDrop={(e) => { e.preventDefault(); const from = dragFrom.current; dragFrom.current = -1; setOver(-1); if (from >= 0) on.move(from, i); }}
          >
            {sel && (
              <div className="pe-tools" onClick={(e) => e.stopPropagation()}>
                <span className="pe-tag">{BLOCK_LABELS[b.t]}</span>
                <span
                  className="pe-drag"
                  draggable
                  title="Arraste para mudar de lugar"
                  onDragStart={(e) => {
                    dragFrom.current = i;
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', b.id);
                    const blk = e.currentTarget.closest('.pe-blk');
                    if (blk) e.dataTransfer.setDragImage(blk, 16, 16);
                  }}
                  onDragEnd={() => { dragFrom.current = -1; setOver(-1); }}
                ><EIcon name="drag" size={16} /></span>
                <button type="button" onClick={() => on.move(i, i - 1)} disabled={i === 0} title="Subir" aria-label="Subir bloco"><EIcon name="up" size={16} /></button>
                <button type="button" onClick={() => on.move(i, i + 1)} disabled={i === last} title="Descer" aria-label="Descer bloco"><EIcon name="down" size={16} /></button>
                <button type="button" onClick={() => on.duplicate(b.id)} title="Duplicar" aria-label="Duplicar bloco"><EIcon name="copy" size={16} /></button>
                <button type="button" onClick={() => on.remove(b.id)} title="Excluir" aria-label="Excluir bloco"><EIcon name="trash" size={16} /></button>
              </div>
            )}
            <Block b={b} theme={theme} editing />
          </div>
        );
      })}
    </div>
  );
}
