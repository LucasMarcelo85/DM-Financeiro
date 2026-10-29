import { useEffect, useMemo, useState } from 'react';
import EIcon from '../contract/EIcon.jsx';
import { Check, ColorField, GalleryField, ImageField, LinkFields, RangeField, Section, Seg, TextField } from './Fields.jsx';
import IconPicker from './IconPicker.jsx';
import { fillBackground } from './Canvas.jsx';
import {
  BTN_STYLES, CARD_STYLES, CATALOG_DISPLAY, DESIGN_W, ELEMENT_LABELS, ENTER_OPTIONS, FILL_ANIM_OPTIONS, HOVER_OPTIONS, LOOP_OPTIONS, SHADOW_OPTIONS,
  TEXT_SHADOW_OPTIONS, WEIGHT_OPTIONS, autoHeight,
} from '../../lib/portfolio/doc.js';
import { FONTS, FONT_GROUPS, THEME_PRESETS, pageUrl, parseVideo } from '../../lib/portfolio/model.js';
import { MASK_LIST, SHAPE_LIST, SHAPE_PATHS } from '../../lib/portfolio/shapes.js';
import { maskPhone } from '../../lib/format.js';

// Painel de propriedades. Com um elemento selecionado mostra as opções dele; sem seleção mostra as da página.
const ALIGN = [['left', 'Esq.'], ['center', 'Centro'], ['right', 'Dir.'], ['justify', 'Justif.']];
const VALIGN = [['top', 'Topo'], ['middle', 'Meio'], ['bottom', 'Base']];
const FIT = [['cover', 'Preencher'], ['contain', 'Caber'], ['fill', 'Esticar']];
const BORDER_STYLE = [['solid', 'Contínua'], ['dashed', 'Tracejada'], ['dotted', 'Pontilhada']];
const ICON_BG = [['none', 'Sem fundo'], ['circle', 'Círculo'], ['rounded', 'Arredondado'], ['square', 'Quadrado']];
const FIXED_ANCHORS = [['top-left', 'Superior esquerdo'], ['top-right', 'Superior direito'], ['bottom-left', 'Inferior esquerdo'], ['bottom-right', 'Inferior direito']];
const SCROLL_ACTIONS = [['none', 'Nenhuma'], ['top', 'Rolar para o topo'], ['bottom', 'Rolar para o fim da página']];
const TEXT_COLOR_STYLES = new Set(['solid', 'gradient', 'flow', 'glass', 'threed', 'lift', 'retro', 'shine']);
const TWO_COLOR_STYLES = new Set(['gradient', 'flow']);
const META_ID = /^\d{8,20}$/;
const GOOGLE_ID = /^(G|AW|GT|DC)-[A-Za-z0-9-]{4,30}$/;
const TIKTOK_ID = /^[A-Z0-9]{8,30}$/;

const Select = ({ label, value, options, onChange, id }) => (
  <label className="ce-field">
    <span>{label}</span>
    <select className="input input-sm" id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </label>
);

const FontSelect = ({ label, value, onChange, allowDefault }) => (
  <label className="ce-field">
    <span>{label}</span>
    <select className="input input-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowDefault && <option value="">Padrão da página</option>}
      {FONT_GROUPS.map((g) => (
        <optgroup key={g} label={g}>{FONTS.filter((f) => f.group === g).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</optgroup>
      ))}
    </select>
  </label>
);

function NumField({ label, value, onChange, min = -9999, max = 9999, step = 1, suffix }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="ce-field ce-num">
      <span>{label}</span>
      <span className="pe-num">
        <input className="input input-sm" type="number" inputMode="decimal" min={min} max={max} step={step} value={text}
          onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); }}
          onBlur={() => setText(String(value))} />
        {suffix && <em>{suffix}</em>}
      </span>
    </label>
  );
}

// Preenchimento: cor sólida ou degradê, com efeito de cor animado.
function FillFields({ fill, onChange, label = 'Preenchimento', allowAnimate = true }) {
  const set = (k) => (v) => onChange({ ...fill, [k]: v });
  return (
    <>
      <Seg label={label} value={fill.type} options={[['solid', 'Cor'], ['gradient', 'Degradê']]} onChange={set('type')} id="fill-type" />
      <ColorField label={fill.type === 'gradient' ? 'Cor inicial' : 'Cor'} value={fill.c1} onChange={set('c1')} id="fill-c1" />
      {fill.type === 'gradient' && (
        <>
          <ColorField label="Cor final" value={fill.c2} onChange={set('c2')} id="fill-c2" />
          <RangeField label="Ângulo do degradê" value={fill.angle} min={0} max={360} step={5} suffix="°" onChange={set('angle')} id="fill-angle" />
        </>
      )}
      {allowAnimate && <Select label="Efeito de cor" value={fill.animate} options={FILL_ANIM_OPTIONS.filter(([k]) => k !== 'flow' || fill.type === 'gradient')} onChange={set('animate')} />}
      {allowAnimate && fill.animate === 'flow' && fill.type !== 'gradient' && <p className="muted small">O degradê em movimento precisa do preenchimento em “Degradê”.</p>}
    </>
  );
}

// ---------------------------------------------------------------- elementos
function PositionSection({ el, device, api, layoutBox }) {
  const b = layoutBox;
  const W = DESIGN_W[device];
  const set = (k) => (v) => api.box({ [k]: Math.round(v) }, `box:${k}`);
  const hasFont = el.t === 'text' || el.t === 'button';
  return (
    <Section title={`Posição e tamanho · ${{ desktop: 'Computador', tablet: 'Tablet', mobile: 'Celular' }[device]}`}>
      <p className="muted small">Cada dispositivo tem a sua própria posição e tamanho. O que você muda aqui vale só para este.</p>
      <div className="pe-grid4">
        <NumField label="X" value={Math.round(b.x)} min={-1000} max={4000} onChange={set('x')} />
        <NumField label="Y" value={Math.round(b.y)} min={-200} max={30000} onChange={set('y')} />
        <NumField label="Largura" value={Math.round(b.w)} min={4} max={W * 3} onChange={set('w')} />
        {!autoHeight(el) && <NumField label="Altura" value={Math.round(b.h)} min={4} max={8000} onChange={set('h')} />}
      </div>
      {hasFont && <NumField label="Tamanho da letra" value={b.fs} min={6} max={400} suffix="px" onChange={set('fs')} />}
      <RangeField label="Girar" value={b.r} min={-180} max={180} step={1} suffix="°" onChange={(v) => api.box({ r: Math.round(v) }, 'box:r')} id="rot" />
      <div className="pe-align" role="group" aria-label="Alinhar na página">
        {[['left', 'align-left', 'Esquerda'], ['hcenter', 'align-center', 'Centro'], ['right', 'align-right', 'Direita'], ['top', 'align-top', 'Topo'], ['vcenter', 'align-middle', 'Meio'], ['bottom', 'align-bottom', 'Base']].map(([k, ic, t]) => (
          <button key={k} type="button" className="ce-mini" title={`Alinhar: ${t}`} aria-label={`Alinhar: ${t}`} onClick={() => api.act(`align:${k}`)}><EIcon name={ic} size={16} /></button>
        ))}
      </div>
      <Check label="Esconder neste dispositivo" checked={Boolean(b.hide)} onChange={(v) => api.box({ hide: v })} />
      {device !== 'desktop' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.act('copy-from-desktop')}>Copiar posição do computador</button>}
    </Section>
  );
}

function TextSection({ el, api }) {
  const f = (k) => (v) => api.patch({ [k]: v }, `el:${k}`);
  return (
    <Section title="Texto">
      <TextField label="Conteúdo" value={el.text} onChange={f('text')} multiline rows={4} maxLength={4000} id="text-content" />
      <FontSelect label="Fonte" value={el.font} onChange={f('font')} />
      <Seg label="Peso" value={el.weight} options={WEIGHT_OPTIONS} onChange={f('weight')} id="weight" />
      <div className="pe-checks">
        <Check label="Itálico" checked={el.italic} onChange={f('italic')} />
        <Check label="Sublinhado" checked={el.underline} onChange={f('underline')} />
        <Check label="MAIÚSCULAS" checked={el.upper} onChange={f('upper')} />
      </div>
      <Seg label="Alinhamento" value={el.align} options={ALIGN} onChange={f('align')} id="align" />
      <Seg label="Posição vertical" value={el.valign} options={VALIGN} onChange={f('valign')} id="valign" />
      <RangeField label="Altura da linha" value={el.lineHeight} min={0.8} max={3} step={0.05} onChange={f('lineHeight')} id="lh" format={(v) => v.toFixed(2)} />
      <RangeField label="Espaço entre letras" value={el.spacing} min={-5} max={30} step={0.5} suffix="px" onChange={f('spacing')} id="ls" />
      <ColorField label="Cor do texto" value={el.color} onChange={f('color')} id="text-color" />
      <Check label="Texto com degradê / efeito de cor" checked={el.useFill} onChange={f('useFill')} />
      {el.useFill && <FillFields fill={el.fill} label="Preenchimento do texto" onChange={(fill) => api.patch({ fill }, 'el:fill')} />}
      {!el.useFill && (
        <>
          <Select label="Sombra do texto" value={el.shadow} options={TEXT_SHADOW_OPTIONS} onChange={f('shadow')} />
          {el.shadow !== 'none' && <ColorField label={el.shadow === 'neon' ? 'Cor do neon' : 'Cor da sombra'} value={el.shadowColor} onChange={f('shadowColor')} id="shadow-color" />}
        </>
      )}
    </Section>
  );
}

function ImageSection({ el, api }) {
  const f = (k) => (v) => api.patch({ [k]: v }, `el:${k}`);
  const fl = (k) => (v) => api.patch({ filters: { ...el.filters, [k]: v } }, `filter:${k}`);
  return (
    <>
      <Section title="Imagem">
        <ImageField label="Imagem" value={el.src} onChange={(v) => api.patch({ src: v, zoom: 1, px: 50, py: 50 })} onError={api.error} />
        {el.src && (
          <>
            <div className="pe-tools" role="group" aria-label="Ferramentas da imagem">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.imageTool('crop')}><EIcon name="crop" size={15} /> Recortar</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.imageTool('bg')}><EIcon name="wand" size={15} /> Remover fundo</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.imageTool('size')}><EIcon name="resize" size={15} /> Dimensionar</button>
            </div>
            <Seg label="Ajuste na moldura" value={el.fit} options={FIT} onChange={f('fit')} id="fit" />
            <RangeField label="Zoom" value={el.zoom} min={1} max={5} step={0.05} onChange={f('zoom')} id="zoom" format={(v) => `${Math.round(v * 100)}%`} />
            {el.zoom > 1 && (
              <>
                <RangeField label="Posição horizontal" value={el.px} min={0} max={100} suffix="%" onChange={f('px')} id="px" />
                <RangeField label="Posição vertical" value={el.py} min={0} max={100} suffix="%" onChange={f('py')} id="py" />
              </>
            )}
            <div className="pe-checks">
              <Check label="Espelhar na horizontal" checked={el.flipX} onChange={f('flipX')} />
              <Check label="Espelhar na vertical" checked={el.flipY} onChange={f('flipY')} />
            </div>
            <TextField label="Descrição da imagem (para acessibilidade)" value={el.alt} onChange={f('alt')} maxLength={160} id="alt" />
          </>
        )}
      </Section>
      <Section title="Formato e borda">
        <Select label="Formato da imagem" value={el.mask} options={MASK_LIST} onChange={f('mask')} />
        {el.mask === 'none' && <RangeField label="Cantos arredondados" value={el.radius} min={0} max={200} suffix="px" onChange={f('radius')} id="radius" />}
        <RangeField label="Espessura da borda" value={el.borderW} min={0} max={30} suffix="px" onChange={f('borderW')} id="bw" />
        {el.borderW > 0 && <ColorField label="Cor da borda" value={el.borderColor} onChange={f('borderColor')} id="bc" />}
        <Select label="Sombra" value={el.shadow} options={SHADOW_OPTIONS} onChange={f('shadow')} />
        <RangeField label="Opacidade" value={el.opacity} min={5} max={100} suffix="%" onChange={f('opacity')} id="op" />
      </Section>
      <Section title="Cores da imagem">
        <RangeField label="Brilho" value={el.filters.brightness} min={0} max={200} suffix="%" onChange={fl('brightness')} id="f-br" />
        <RangeField label="Contraste" value={el.filters.contrast} min={0} max={200} suffix="%" onChange={fl('contrast')} id="f-ct" />
        <RangeField label="Saturação" value={el.filters.saturate} min={0} max={300} suffix="%" onChange={fl('saturate')} id="f-sa" />
        <RangeField label="Preto e branco" value={el.filters.grayscale} min={0} max={100} suffix="%" onChange={fl('grayscale')} id="f-gr" />
        <RangeField label="Sépia" value={el.filters.sepia} min={0} max={100} suffix="%" onChange={fl('sepia')} id="f-se" />
        <RangeField label="Mudar a cor (matiz)" value={el.filters.hue} min={0} max={360} suffix="°" onChange={fl('hue')} id="f-hu" />
        <RangeField label="Desfoque" value={el.filters.blur} min={0} max={20} suffix="px" onChange={fl('blur')} id="f-bl" />
        <button type="button" className="link-btn" onClick={() => api.patch({ filters: { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, blur: 0, hue: 0, sepia: 0 } })}>Restaurar cores originais</button>
      </Section>
    </>
  );
}

function IconSection({ el, api }) {
  const f = (k) => (v) => api.patch({ [k]: v }, `el:${k}`);
  return (
    <Section title="Ícone">
      <IconPicker value={el.name} onChange={f('name')} />
      <ColorField label="Cor do ícone" value={el.color} onChange={f('color')} id="icon-color" />
      <Seg label="Fundo" value={el.bg} options={ICON_BG} onChange={f('bg')} id="icon-bg" />
      {el.bg !== 'none' && (
        <>
          <ColorField label="Cor do fundo" value={el.bgColor} onChange={f('bgColor')} id="icon-bgc" />
          <RangeField label="Borda" value={el.borderW} min={0} max={12} suffix="px" onChange={f('borderW')} id="icon-bw" />
          {el.borderW > 0 && <ColorField label="Cor da borda" value={el.borderColor} onChange={f('borderColor')} id="icon-bc" />}
          <Select label="Sombra" value={el.shadow} options={SHADOW_OPTIONS} onChange={f('shadow')} />
        </>
      )}
      <Check label="Manter fixo na tela durante a rolagem" checked={el.fixed} onChange={f('fixed')} />
      {el.fixed && <Select label="Canto da tela" value={el.fixedAnchor} options={FIXED_ANCHORS} onChange={f('fixedAnchor')} />}
      <Select label="Ação ao clicar" value={el.scrollAction} options={SCROLL_ACTIONS} onChange={f('scrollAction')} />
    </Section>
  );
}

function ButtonSection({ el, api }) {
  const f = (k) => (v) => api.patch({ [k]: v }, `el:${k}`);
  return (
    <Section title="Botão">
      <TextField label="Texto do botão" value={el.label} onChange={f('label')} maxLength={120} id="btn-label" />
      <div className="ce-field">
        <span>Estilo</span>
        <div className="pe-btnstyles" role="radiogroup" aria-label="Estilo do botão">
          {BTN_STYLES.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={el.style === k} className={`pe-btnstyle${el.style === k ? ' is-on' : ''}`} onClick={() => f('style')(k)}>
              <span className={`pv-btn is-${k}`} style={{ '--c1': el.color, '--c2': el.color2, '--tc': el.textColor, '--rad': '8px', fontSize: 11, pointerEvents: 'none' }}>Abc</span>
              <small>{l}</small>
            </button>
          ))}
        </div>
      </div>
      <ColorField label={TWO_COLOR_STYLES.has(el.style) ? 'Cor inicial' : 'Cor do botão'} value={el.color} onChange={f('color')} id="btn-c1" />
      {TWO_COLOR_STYLES.has(el.style) && <ColorField label="Cor final" value={el.color2} onChange={f('color2')} id="btn-c2" />}
      {TEXT_COLOR_STYLES.has(el.style) && <ColorField label="Cor do texto" value={el.textColor} onChange={f('textColor')} id="btn-tc" />}
      <FontSelect label="Fonte" value={el.font} onChange={f('font')} />
      <Seg label="Peso" value={el.weight} options={WEIGHT_OPTIONS} onChange={f('weight')} id="btn-weight" />
      <RangeField label="Cantos arredondados" value={el.radius} min={0} max={100} suffix="px" onChange={f('radius')} id="btn-radius" />
      <IconPicker label="Ícone no botão" value={el.icon} onChange={f('icon')} allowNone />
      {el.icon && <Seg label="Posição do ícone" value={el.iconPos} options={[['left', 'Esquerda'], ['right', 'Direita']]} onChange={f('iconPos')} id="btn-iconpos" />}
    </Section>
  );
}

function FullWidthToggle({ el, device, api }) {
  const W = DESIGN_W[device];
  return (
    <>
      <Check label="Largura total da tela (de ponta a ponta)" checked={Boolean(el.full)} onChange={(v) => { api.patch({ full: v }, 'el:full'); if (v) api.box({ x: 0, w: W }, 'box:full'); }} />
      {el.full && <p className="muted small">Ocupa a tela inteira, mesmo em monitores grandes. Ajuste só a altura e a posição vertical. Ideal para barra de menu, rodapé e faixas de fundo.</p>}
    </>
  );
}

function SpacerSection({ el, device, api }) {
  const f = (k) => (v) => api.patch({ [k]: v }, `el:${k}`);
  return (
    <Section title="Espaçador / faixa de fundo">
      <p className="muted small">Reserva um espaço na página. Se uma lista de produtos acima crescer, o conteúdo abaixo é deslocado para preservar esse espaço. A faixa começa transparente; aumente a opacidade se também quiser colorir o fundo.</p>
      <FullWidthToggle el={el} device={device} api={api} />
      <FillFields fill={el.fill} onChange={(fill) => api.patch({ fill }, 'el:fill')} />
      <RangeField label="Opacidade" value={el.opacity} min={0} max={100} suffix="%" onChange={f('opacity')} id="sp-op" />
      <RangeField label="Borda" value={el.borderW} min={0} max={40} suffix="px" onChange={f('borderW')} id="sp-bw" />
      {el.borderW > 0 && <ColorField label="Cor da borda" value={el.borderColor} onChange={f('borderColor')} id="sp-bc" />}
      <Select label="Sombra" value={el.shadow} options={SHADOW_OPTIONS} onChange={f('shadow')} />
    </Section>
  );
}

function ShapeSection({ el, device, api }) {
  const f = (k) => (v) => api.patch({ [k]: v }, `el:${k}`);
  return (
    <Section title="Forma">
      {el.shape === 'rect' && <FullWidthToggle el={el} device={device} api={api} />}
      <div className="ce-field">
        <span>Forma</span>
        <div className="pe-shapes" role="radiogroup" aria-label="Forma">
          {SHAPE_LIST.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={el.shape === k} title={l} className={`pe-shapebtn${el.shape === k ? ' is-on' : ''}`} onClick={() => f('shape')(k)}>
              <svg viewBox="-0.05 -0.05 1.1 1.1" width="26" height="26" aria-hidden="true">
                {k === 'ring' ? <path d={SHAPE_PATHS.ring} fill="none" stroke="currentColor" strokeWidth="0.16" /> : k === 'line' ? <rect x="0" y="0.44" width="1" height="0.12" rx="0.06" fill="currentColor" /> : <path d={SHAPE_PATHS[k]} fill="currentColor" />}
              </svg>
            </button>
          ))}
        </div>
      </div>
      <FillFields fill={el.fill} onChange={(fill) => api.patch({ fill }, 'el:fill')} />
      <RangeField label="Borda" value={el.borderW} min={0} max={30} suffix="px" onChange={f('borderW')} id="sh-bw" />
      {el.borderW > 0 && (
        <>
          <ColorField label="Cor da borda" value={el.borderColor} onChange={f('borderColor')} id="sh-bc" />
          <Seg label="Tipo de borda" value={el.borderStyle} options={BORDER_STYLE} onChange={f('borderStyle')} id="sh-bs" />
        </>
      )}
      {el.shape === 'rect' && <RangeField label="Cantos arredondados" value={el.radius} min={0} max={200} suffix="px" onChange={f('radius')} id="sh-radius" />}
      {el.shape === 'ring' && <RangeField label="Espessura do anel" value={el.radius || 20} min={2} max={200} suffix="px" onChange={f('radius')} id="sh-ring" />}
      <Select label="Sombra" value={el.shadow} options={SHADOW_OPTIONS} onChange={f('shadow')} />
      <RangeField label="Opacidade" value={el.opacity} min={5} max={100} suffix="%" onChange={f('opacity')} id="sh-op" />
      <Check label="Manter fixa na tela durante a rolagem" checked={el.fixed} onChange={f('fixed')} />
      {el.fixed && <Select label="Canto da tela" value={el.fixedAnchor} options={FIXED_ANCHORS} onChange={f('fixedAnchor')} />}
      <Select label="Ação ao clicar" value={el.scrollAction} options={SCROLL_ACTIONS} onChange={f('scrollAction')} />
      <div className="pe-fillprev" style={{ background: fillBackground(el.fill) }} aria-hidden="true" />
    </Section>
  );
}

function VideoSection({ el, api }) {
  const f = (k) => (v) => api.patch({ [k]: v }, `el:${k}`);
  const bad = el.url && !parseVideo(el.url);
  return (
    <Section title="Vídeo">
      <TextField label="Link do vídeo (YouTube ou Vimeo)" value={el.url} onChange={f('url')} placeholder="https://www.youtube.com/watch?v=..." id="video-url" hint={bad ? 'Link não reconhecido. Use um link do YouTube ou do Vimeo.' : undefined} />
      <RangeField label="Cantos arredondados" value={el.radius} min={0} max={100} suffix="px" onChange={f('radius')} id="video-radius" />
    </Section>
  );
}

const NEW_LINK = () => ({ kind: 'link', url: '', phone: '', message: '', email: '' });
const sid = () => Math.random().toString(36).slice(2, 10);

function CarouselSection({ el, api }) {
  const f = (k) => (v) => api.patch({ [k]: v }, `el:${k}`);
  const slides = el.slides || [];
  const setSlide = (id, patch, key) => api.patch({ slides: slides.map((s) => (s.id === id ? { ...s, ...patch } : s)) }, key);
  return (
    <>
      <Section title="Imagens do carrossel">
        <GalleryField items={slides} max={12} onError={api.error}
          onAdd={(srcs) => api.patch({ slides: [...slides, ...srcs.map((src) => ({ id: sid(), src, alt: '', link: NEW_LINK() }))].slice(0, 12) })}
          onRemove={(id) => api.patch({ slides: slides.filter((s) => s.id !== id) })} />
        {slides.map((s, i) => (
          <details key={s.id} className="pe-sub">
            <summary>Imagem {i + 1}: descrição e link</summary>
            <TextField label="Descrição (acessibilidade)" value={s.alt} onChange={(v) => setSlide(s.id, { alt: v }, `car-alt:${s.id}`)} maxLength={160} id={`car-alt-${s.id}`} />
            <LinkFields link={s.link} onChange={(link, key) => setSlide(s.id, { link }, key)} id={`car-${s.id}`} />
          </details>
        ))}
      </Section>
      <Section title="Comportamento">
        <Check label="Passar sozinho" checked={el.autoplay} onChange={f('autoplay')} />
        {el.autoplay && <RangeField label="Tempo por imagem" value={el.interval} min={2} max={15} suffix=" s" onChange={f('interval')} id="car-int" />}
        <Check label="Mostrar setas" checked={el.arrows} onChange={f('arrows')} />
        <Check label="Mostrar pontinhos" checked={el.dots} onChange={f('dots')} />
        <Seg label="Ajuste na moldura" value={el.fit} options={[['cover', 'Preencher'], ['contain', 'Caber']]} onChange={f('fit')} id="car-fit" />
        <RangeField label="Cantos arredondados" value={el.radius} min={0} max={100} suffix="px" onChange={f('radius')} id="car-rad" />
      </Section>
    </>
  );
}

function MenuSection({ el, api }) {
  const f = (k) => (v) => api.patch({ [k]: v }, `el:${k}`);
  const items = el.items || [];
  const setItem = (id, patch, key) => api.patch({ items: items.map((s) => (s.id === id ? { ...s, ...patch } : s)) }, key);
  return (
    <>
      <Section title="Itens do menu">
        {items.map((s, i) => (
          <details key={s.id} className="pe-sub" open={!s.label}>
            <summary>{s.label || `Item ${i + 1}`}</summary>
            <TextField label="Texto" value={s.label} onChange={(v) => setItem(s.id, { label: v }, `menu-l:${s.id}`)} maxLength={40} id={`menu-l-${s.id}`} />
            <LinkFields link={s.link} onChange={(link, key) => setItem(s.id, { link }, key)} id={`menu-${s.id}`} />
            <button type="button" className="link-btn" onClick={() => api.patch({ items: items.filter((x) => x.id !== s.id) })}>Remover item</button>
          </details>
        ))}
        {items.length < 12 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.patch({ items: [...items, { id: sid(), label: 'Novo item', link: NEW_LINK() }] })}>
            <EIcon name="plus" size={16} /> Adicionar item
          </button>
        )}
      </Section>
      <Section title="Aparência">
        <Select label="Exibição" value={el.variant} onChange={f('variant')} options={[['auto', 'Automático (hambúrguer no celular)'], ['hamburger', 'Sempre botão hambúrguer'], ['bar', 'Sempre barra de links']]} />
        <TextField label="Texto ao lado do botão (opcional)" value={el.title} onChange={f('title')} maxLength={40} id="menu-title" />
        <ColorField label="Cor do texto e ícone" value={el.color} onChange={f('color')} id="menu-c" />
        <ColorField label="Cor de fundo" value={el.bg} onChange={f('bg')} id="menu-bg" />
        <RangeField label="Cantos arredondados" value={el.radius} min={0} max={60} suffix="px" onChange={f('radius')} id="menu-r" />
      </Section>
    </>
  );
}

function CatSearchSection({ el, api }) {
  const f = (k) => (v) => api.patch({ [k]: v }, `el:${k}`);
  return (
    <Section title="Busca e categorias">
      <Check label="Mostrar barra de busca" checked={el.showSearch} onChange={f('showSearch')} />
      <Check label="Mostrar categorias" checked={el.showCategories} onChange={f('showCategories')} />
      <TextField label="Texto da busca" value={el.placeholder} onChange={f('placeholder')} maxLength={60} id="cs-ph" />
    </Section>
  );
}

function CatGridSection({ el, api }) {
  const set = (k) => (v) => api.patch({ cols: { ...el.cols, [k]: v } }, 'el:cols');
  return (
    <Section title="Produtos do catálogo">
      <RangeField label="Colunas no computador" value={el.cols.desktop} min={1} max={6} onChange={set('desktop')} id="cg-d" />
      <RangeField label="Colunas no tablet" value={el.cols.tablet} min={1} max={6} onChange={set('tablet')} id="cg-t" />
      <RangeField label="Colunas no celular" value={el.cols.mobile} min={1} max={4} onChange={set('mobile')} id="cg-m" />
      <p className="muted small">O visual do cartão fica em <strong>Página &gt; Catálogo</strong> e aparece aqui na hora.</p>
    </Section>
  );
}

function ProductsSection({ el, api, products }) {
  const [q, setQ] = useState('');
  const f = (k) => (v) => api.patch({ [k]: v }, `el:${k}`);
  const list = useMemo(() => products.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()) || p.category.toLowerCase().includes(q.trim().toLowerCase())), [products, q]);
  const toggle = (id) => api.patch({ ids: el.ids.includes(id) ? el.ids.filter((x) => x !== id) : [...el.ids, id].slice(0, 24) }, 'el:ids');
  return (
    <Section title="Produtos / serviços">
      {!products.length && <p className="muted small">Você ainda não cadastrou produtos. Cadastre na aba <strong>Produtos/Serviços</strong> e volte aqui.</p>}
      {products.length > 0 && (
        <>
          <input className="input input-sm" type="search" placeholder="Buscar produto" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar produto" />
          <div className="pe-prodlist">
            {list.map((p) => (
              <label key={p.id} className="pe-check pe-prod">
                <input type="checkbox" checked={el.ids.includes(p.id)} onChange={() => toggle(p.id)} />
                {(p.mainImage || p.images[0]) && <img src={(p.mainImage || p.images[0]).url} alt="" />}
                <span>{p.name}<small>{p.category}</small></span>
              </label>
            ))}
          </div>
          <p className="muted small">{el.ids.length} de 24 escolhidos.</p>
        </>
      )}
      <RangeField label="Colunas no computador" value={el.cols.desktop} min={1} max={6} onChange={(v) => api.patch({ cols: { ...el.cols, desktop: v } }, 'el:cols')} id="cols-d" />
      <RangeField label="Colunas no tablet" value={el.cols.tablet} min={1} max={6} onChange={(v) => api.patch({ cols: { ...el.cols, tablet: v } }, 'el:cols')} id="cols-t" />
      <RangeField label="Colunas no celular" value={el.cols.mobile} min={1} max={4} onChange={(v) => api.patch({ cols: { ...el.cols, mobile: v } }, 'el:cols')} id="cols-m" />
      <Seg label="Estilo do cartão" value={el.cardStyle} options={CARD_STYLES} onChange={f('cardStyle')} id="cardstyle" />
      <Check label="Mostrar preço" checked={el.showPrice} onChange={f('showPrice')} />
      <TextField label="WhatsApp para pedidos (com DDD)" value={el.whatsapp ? maskPhone(el.whatsapp) : ''} onChange={(v) => f('whatsapp')(v.replace(/\D/g, ''))} placeholder="(85) 99999-9999" id="prod-wa" hint="Com o número, cada cartão ganha um botão que abre uma conversa já falando do produto." />
      {el.whatsapp && <TextField label="Texto do botão" value={el.buttonLabel} onChange={f('buttonLabel')} maxLength={40} id="prod-btn" />}
    </Section>
  );
}

function AnimationSection({ el, api }) {
  const a = el.anim;
  const f = (k) => (v) => api.patch({ anim: { ...a, [k]: v } }, `anim:${k}`);
  return (
    <Section title="Animações">
      <Select label="Ao aparecer na tela" value={a.enter} options={ENTER_OPTIONS} onChange={f('enter')} />
      {a.enter !== 'none' && (
        <>
          <RangeField label="Atraso" value={a.delay} min={0} max={3000} step={50} suffix=" ms" onChange={f('delay')} id="an-delay" />
          <RangeField label="Duração" value={a.duration} min={200} max={3000} step={50} suffix=" ms" onChange={f('duration')} id="an-dur" />
        </>
      )}
      <Select label="Movimento contínuo" value={a.loop} options={LOOP_OPTIONS} onChange={f('loop')} />
      <Select label="Ao passar o mouse" value={a.hover} options={HOVER_OPTIONS} onChange={f('hover')} />
      <button type="button" className="btn btn-ghost btn-sm" onClick={api.play}><EIcon name="play" size={15} /> Testar animações da página</button>
    </Section>
  );
}

function LayerSection({ el, api }) {
  return (
    <Section title="Camada e ações">
      <div className="pe-tools" role="group" aria-label="Camadas">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.act('front')}>Trazer para frente</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.act('up')}>Subir</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.act('down')}>Descer</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.act('back')}>Enviar para trás</button>
      </div>
      <TextField label="Nome (só para você se achar)" value={el.name} onChange={(v) => api.patch({ name: v }, 'el:name')} maxLength={60} id="el-name" />
      <Check label="Travar (não arrasta por engano)" checked={el.locked} onChange={(v) => api.patch({ locked: v })} />
      <div className="pe-tools">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.act('duplicate')}><EIcon name="copy" size={15} /> Duplicar</button>
        <button type="button" className="btn btn-danger btn-sm" onClick={() => api.act('delete')}><EIcon name="trash" size={15} /> Excluir</button>
      </div>
    </Section>
  );
}

export function ElementInspector({ el, device, api, products, layoutBox }) {
  const linkable = ['text', 'image', 'icon', 'button', 'shape'].includes(el.t) && el.scrollAction === 'none';
  return (
    <div className="ce-insp">
      <h3 className="pe-insp-title">{ELEMENT_LABELS[el.t]}{el.name ? ` · ${el.name}` : ''}</h3>
      {el.t === 'text' && <TextSection el={el} api={api} />}
      {el.t === 'image' && <ImageSection el={el} api={api} />}
      {el.t === 'icon' && <IconSection el={el} api={api} />}
      {el.t === 'button' && <ButtonSection el={el} api={api} />}
      {el.t === 'shape' && <ShapeSection el={el} device={device} api={api} />}
      {el.t === 'spacer' && <SpacerSection el={el} device={device} api={api} />}
      {el.t === 'video' && <VideoSection el={el} api={api} />}
      {el.t === 'carousel' && <CarouselSection el={el} api={api} />}
      {el.t === 'menu' && <MenuSection el={el} api={api} />}
      {el.t === 'products' && <ProductsSection el={el} api={api} products={products} />}
      {el.t === 'catsearch' && <CatSearchSection el={el} api={api} />}
      {el.t === 'catgrid' && <CatGridSection el={el} api={api} />}
      {linkable && (
        <Section title={el.t === 'button' ? 'Link do botão' : 'Link ao clicar'}>
          <LinkFields link={el.link} onChange={(link, key) => api.patch({ link }, key || 'el:link')} id={`link-${el.id}`} />
          {el.t !== 'button' && <p className="muted small">Deixe em branco se não quiser que {{ text: 'o texto', image: 'a imagem', icon: 'o ícone', shape: 'a forma' }[el.t]} abra nada.</p>}
        </Section>
      )}
      <PositionSection el={el} device={device} api={api} layoutBox={layoutBox} />
      <AnimationSection el={el} api={api} />
      <LayerSection el={el} api={api} />
    </div>
  );
}

// ---------------------------------------------------------------- página (nada selecionado)
function AddressSection({ meta, onSaveSlug, onCopy }) {
  const [slug, setSlug] = useState(meta.slug);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSlug(meta.slug), [meta.slug]);
  const url = pageUrl(meta.path, meta.customUrl);
  const changed = slug.trim() !== meta.slug && slug.trim() !== '';
  return (
    <Section title="Endereço da página">
      <div className="pe-addr">
        <code title={url}>{url.replace(/^https?:\/\//, '')}</code>
        <button type="button" className="ce-mini" onClick={onCopy} title="Copiar link" aria-label="Copiar link"><EIcon name="copy" size={16} /></button>
      </div>
      {meta.isMain
        ? <p className="muted small">Esta é a <strong>página principal</strong>: abre direto no seu endereço, sem nada depois da barra. O endereço vem do seu nome ou razão social e não muda.</p>
        : (
          <>
            <label className="ce-field">
              <span>Final do endereço</span>
              <input className="input input-sm" value={slug} maxLength={60} onChange={(e) => setSlug(e.target.value)} aria-label="Final do endereço da página" />
            </label>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!changed || busy} onClick={async () => { setBusy(true); await onSaveSlug(slug); setBusy(false); }}>{busy ? 'Salvando...' : 'Salvar endereço'}</button>
            <p className="muted small">Só letras, números e hífen. Se você mudar, o link antigo deixa de funcionar.</p>
          </>
        )}
    </Section>
  );
}

function PixelSection({ doc, api }) {
  const px = doc.pixel;
  const set = (k) => (v) => api.patchPixel({ [k]: v.trim() }, `pixel:${k}`);
  const warn = (v, re) => (v && !re.test(v) ? 'Formato não reconhecido: confira o código.' : undefined);
  return (
    <Section title="Pixel e rastreamento (tráfego pago)">
      <p className="muted small">Cole só o <strong>código</strong> do pixel para medir os resultados dos seus anúncios. Eles funcionam na página publicada (não aqui no editor).</p>
      <TextField label="Pixel do Meta (Facebook e Instagram)" value={px.meta} onChange={set('meta')} placeholder="Ex.: 123456789012345" id="px-meta" maxLength={20} hint={warn(px.meta, META_ID) || 'Gerenciador de Eventos do Meta: número do pixel.'} />
      <TextField label="Google (Analytics ou Ads)" value={px.google} onChange={set('google')} placeholder="Ex.: G-ABC123XYZ ou AW-123456789" id="px-google" maxLength={40} hint={warn(px.google, GOOGLE_ID)} />
      <TextField label="Pixel do TikTok" value={px.tiktok} onChange={set('tiktok')} placeholder="Ex.: C1A2B3D4E5F6G7H8" id="px-tiktok" maxLength={30} hint={warn(px.tiktok, TIKTOK_ID)} />
      <p className="muted small">Eventos enviados: visita à página, clique no WhatsApp/telefone e, no catálogo digital, produto visto, adicionado ao carrinho, pedido iniciado e compra concluída (com o valor).</p>
    </Section>
  );
}

function CardDesigner({ doc, api }) {
  const c = doc.catalog;
  const k = c.card;
  const set = (key) => (v) => api.patchCatalog({ card: { ...k, [key]: v } }, `cat:card:${key}`);
  const custom = Boolean(k.bg || k.text || k.accent);
  return (
    <Section title="Cartão do produto">
      <Seg label="Disposição" value={k.layout} options={[['vertical', 'Foto em cima'], ['horizontal', 'Foto ao lado']]} onChange={set('layout')} id="cd-layout" />
      <Select label="Formato da foto" value={k.ratio} onChange={set('ratio')} options={[['square', 'Quadrada'], ['portrait', 'Vertical (3:4)'], ['tall', 'Vertical alta (2:3)'], ['landscape', 'Horizontal (4:3)'], ['wide', 'Panorâmica (16:9)'], ['custom', 'Altura fixa (px)']]} />
      {k.ratio === 'custom' && <RangeField label="Altura da foto" value={k.imgHeight} min={60} max={600} step={5} suffix="px" onChange={set('imgHeight')} id="cd-imgh" />}
      <Seg label="Ajuste da foto" value={k.fit} options={[['cover', 'Preencher'], ['contain', 'Inteira']]} onChange={set('fit')} id="cd-fit" />
      {k.fit === 'cover' && (
        <>
          <RangeField label="Foco horizontal da foto" value={k.imgX} min={0} max={100} suffix="%" onChange={set('imgX')} id="cd-imgx" />
          <RangeField label="Foco vertical da foto" value={k.imgY} min={0} max={100} suffix="%" onChange={set('imgY')} id="cd-imgy" />
        </>
      )}
      <RangeField label="Margem dentro da foto" value={k.imgPad} min={0} max={40} suffix="px" onChange={set('imgPad')} id="cd-imgpad" />
      <Check label="Cor de fundo atrás da foto" checked={Boolean(k.imgBg)} onChange={(on) => set('imgBg')(on ? '#f3f5f8' : '')} />
      {k.imgBg && <ColorField label="Fundo da foto" value={k.imgBg} onChange={set('imgBg')} id="cd-imgbg" />}
      <p className="muted small">Todos os cartões ficam do mesmo tamanho: a foto segue o formato escolhido e o botão fica sempre na base.</p>
      <RangeField label="Espaço entre os cartões" value={k.gap} min={6} max={40} suffix="px" onChange={set('gap')} id="cd-gap" />
      <FontSelect label="Fonte do cartão" value={k.font || ''} onChange={set('font')} allowDefault />
      <Seg label="Alinhamento do texto" value={k.align} options={[['left', 'Esquerda'], ['center', 'Centro']]} onChange={set('align')} id="cd-align" />
      <RangeField label="Linhas do nome" value={k.nameLines} min={1} max={3} onChange={set('nameLines')} id="cd-nl" />
      <RangeField label="Arredondamento" value={k.radius} min={0} max={32} onChange={set('radius')} id="cd-radius" />
      <Seg label="Sombra" value={k.shadow} options={[['none', 'Nenhuma'], ['soft', 'Suave'], ['strong', 'Forte']]} onChange={set('shadow')} id="cd-shadow" />
      <Seg label="Espaço interno" value={k.padding} options={[['compact', 'Pequeno'], ['normal', 'Normal'], ['roomy', 'Grande']]} onChange={set('padding')} id="cd-pad" />
      <Seg label="Tamanho do nome" value={k.textSize} options={[['sm', 'Pequeno'], ['md', 'Médio'], ['lg', 'Grande']]} onChange={set('textSize')} id="cd-ts" />
      <Seg label="Tamanho do preço" value={k.priceSize} options={[['sm', 'Pequeno'], ['md', 'Médio'], ['lg', 'Grande']]} onChange={set('priceSize')} id="cd-ps" />
      <Check label="Borda no cartão" checked={k.border} onChange={set('border')} />
      <IconPicker label="Ícone no cartão" value={k.icon} onChange={set('icon')} allowNone />
      {k.icon && (
        <>
          <Seg label="Onde fica o ícone" value={k.iconPos} options={[['button', 'No botão'], ['name', 'Ao lado do nome'], ['corner', 'Canto da foto']]} onChange={set('iconPos')} id="cd-iconpos" />
          <Check label="Cor própria no ícone" checked={Boolean(k.iconColor)} onChange={(on) => set('iconColor')(on ? doc.theme.primary : '')} />
          {k.iconColor && <ColorField label="Cor do ícone" value={k.iconColor} onChange={set('iconColor')} id="cd-iconc" />}
        </>
      )}
      <Seg label="Estilo do botão" value={k.buttonStyle} options={[['solid', 'Cheio'], ['outline', 'Contorno'], ['soft', 'Suave']]} onChange={set('buttonStyle')} id="cd-bt" />
      <Check label="Botão ocupa toda a largura" checked={k.buttonFull} onChange={set('buttonFull')} />
      <Check label={'Escrever "a partir de" quando o preço varia'} checked={k.priceFrom} onChange={set('priceFrom')} />
      <p className="muted small">O que aparece no cartão:</p>
      <Check label="Foto" checked={k.showImage} onChange={set('showImage')} />
      <Check label="Categoria" checked={k.showCategory} onChange={set('showCategory')} />
      <Check label="Nome" checked={k.showName} onChange={set('showName')} />
      <Check label="Descrição" checked={k.showDescription} onChange={set('showDescription')} />
      <Check label="Preço" checked={k.showPrice} onChange={set('showPrice')} />
      <Check label="Preços por quantidade" checked={k.showTiers} onChange={set('showTiers')} />
      <Check label="Variações" checked={k.showVariations} onChange={set('showVariations')} />
      <Check label="Botão" checked={k.showButton} onChange={set('showButton')} />
      <Check label="Usar cores próprias no cartão" checked={custom} onChange={(on) => api.patchCatalog({ card: { ...k, bg: on ? '#ffffff' : '', text: on ? '#14202e' : '', accent: on ? doc.theme.primary : '' } }, 'cat:card:colors')} />
      {custom && <>
        <ColorField label="Fundo do cartão" value={k.bg || '#ffffff'} onChange={set('bg')} id="cd-bg" />
        <ColorField label="Cor do texto" value={k.text || '#14202e'} onChange={set('text')} id="cd-text" />
        <ColorField label="Cor de destaque (preço e botão)" value={k.accent || doc.theme.primary} onChange={set('accent')} id="cd-accent" />
      </>}
    </Section>
  );
}

function CatalogSection({ doc, api, categories, meta, products = [] }) {
  const c = doc.catalog;
  const set = (k) => (v) => api.patchCatalog({ [k]: v }, `cat:${k}`);
  const selectedIds = c.selectedProductIds || [];
  const orderedProducts = [...products].sort((a, b) => a.category.localeCompare(b.category, 'pt-BR') || a.name.localeCompare(b.name, 'pt-BR'));
  const toggleProduct = (id) => api.patchCatalog({ selectedProductIds: selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id] }, 'cat:selected-products');
  return (
    <Section title="Catálogo digital">
      <p className="muted small">Os produtos vêm da aba <strong>Produtos/Serviços</strong>. Os pedidos chegam na aba <strong>Pedidos</strong>.</p>
      <Seg label="Como o cliente faz o pedido" value={c.orderMode || 'cart'} options={[['cart', 'Carrinho'], ['direct', 'WhatsApp direto']]} onChange={set('orderMode')} id="cc-order-mode" />
      {c.orderMode === 'direct' && <p className="muted small">O cliente seleciona a variação e a quantidade; o pedido abre pronto para enviar ao WhatsApp da loja. Configure o número abaixo.</p>}
      <Select label="Como mostrar os produtos" value={c.display} options={CATALOG_DISPLAY} onChange={set('display')} />
      {c.display === 'only' && (
        <label className="ce-field">
          <span>Categoria exibida</span>
          <select className="input input-sm" value={c.onlyCategory} onChange={(e) => set('onlyCategory')(e.target.value)}>
            <option value="">Escolha...</option>
            {categories.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
      )}
      {c.display === 'selected' && (
        <div className="ce-field">
          <span>Produtos que serão exibidos individualmente</span>
          {!orderedProducts.length
            ? <p className="muted small">Cadastre produtos na aba Produtos/Serviços para selecioná-los.</p>
            : (
              <div className="pe-prodlist">
                {orderedProducts.map((product) => (
                  <label key={product.id} className="pe-check pe-prod">
                    <input type="checkbox" checked={selectedIds.includes(product.id)} onChange={() => toggleProduct(product.id)} />
                    {(product.mainImage || product.images[0]) && <img src={(product.mainImage || product.images[0]).url} alt="" />}
                    <span>{product.name}<small>{product.category}</small></span>
                  </label>
                ))}
              </div>
            )}
          <small className="muted">{selectedIds.length} produto(s) selecionado(s).</small>
        </div>
      )}
      <RangeField label="Colunas no computador" value={c.columns.desktop} min={1} max={6} onChange={(v) => api.patchCatalog({ columns: { ...c.columns, desktop: v } }, 'cat:cols')} id="cc-d" />
      <RangeField label="Colunas no tablet" value={c.columns.tablet} min={1} max={6} onChange={(v) => api.patchCatalog({ columns: { ...c.columns, tablet: v } }, 'cat:cols')} id="cc-t" />
      <RangeField label="Colunas no celular" value={c.columns.mobile} min={1} max={3} onChange={(v) => api.patchCatalog({ columns: { ...c.columns, mobile: v } }, 'cat:cols')} id="cc-m" />
      <Seg label="Estilo do cartão" value={c.cardStyle} options={CARD_STYLES} onChange={set('cardStyle')} id="cc-style" />
      <CardDesigner doc={doc} api={api} />
      <Check label="Mostrar busca" checked={c.showSearch} onChange={set('showSearch')} />
      <Check label="Mostrar filtro de categorias" checked={c.showCategories} onChange={set('showCategories')} />
      {c.orderMode === 'direct' ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={api.openCatalogSettings}>Configurar WhatsApp da loja</button>
      ) : (
        <>
          <TextField label="Texto do botão de adicionar" value={c.addLabel} onChange={set('addLabel')} maxLength={30} id="cc-add" />
          <TextField label="Título da página do carrinho" value={c.cartTitle} onChange={set('cartTitle')} maxLength={60} id="cc-cart" />
          <Select label="Layout do carrinho" value={c.cartLayout} options={[['standard', 'Profissional'], ['compact', 'Compacto'], ['split', 'Resumo em destaque']]} onChange={set('cartLayout')} />
          <TextField label="Identificador do link do carrinho" value={c.cartLink} onChange={(v) => set('cartLink')(v.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24))} maxLength={24} id="cc-cart-link" hint={`Link direto: ${pageUrl(meta.path, meta.customUrl)}?${c.cartLink || 'carrinho'}=1`} />
          <TextField label="Botão ou link extra no carrinho (opcional)" value={c.cartButtonLabel} onChange={set('cartButtonLabel')} maxLength={40} id="cc-cart-button-label" placeholder="Ex.: Ver ofertas" />
          <TextField label="Endereço do botão extra" value={c.cartButtonUrl} onChange={set('cartButtonUrl')} maxLength={500} id="cc-cart-button-url" placeholder="https://..." hint="Aceita links http ou https. O botão aparece no carrinho." />
          <TextField label="Aviso na finalização (opcional)" value={c.checkoutNote} onChange={set('checkoutNote')} multiline rows={2} maxLength={300} id="cc-note" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={api.openCatalogSettings}>Configurar entregas e frete</button>
        </>
      )}
    </Section>
  );
}

export function PageInspector({ doc, meta, api, categories, products = [] }) {
  const th = doc.theme;
  const setTheme = (k) => (v, key) => api.patchTheme({ [k]: v }, key || `theme:${k}`);
  const preset = THEME_PRESETS.find((p) => p.primary === th.primary && p.bg === th.bg && p.text === th.text);
  return (
    <div className="ce-insp">
      <p className="muted small pe-insp-hint">Clique em um elemento para editar. Sem nada selecionado, você ajusta a página inteira.</p>
      <AddressSection meta={meta} onSaveSlug={api.saveSlug} onCopy={api.copyLink} />
      <Section title="Fundo e cores">
        <div className="pe-presets" role="group" aria-label="Combinações de cores">
          {THEME_PRESETS.map((p) => (
            <button key={p.key} type="button" className={`pe-preset ${preset?.key === p.key ? 'is-on' : ''}`} style={{ '--pp': p.primary, '--pb': p.bg }}
              onClick={() => api.patchTheme({ primary: p.primary, bg: p.bg, text: p.text }, `preset:${p.key}`)}>
              <i /> {p.label}
            </button>
          ))}
        </div>
        <ColorField label="Cor principal (novos botões e formas)" value={th.primary} onChange={setTheme('primary')} id="primary" />
        <Seg label="Fundo da página" value={th.bgType} options={[['solid', 'Cor'], ['gradient', 'Degradê']]} onChange={setTheme('bgType')} id="bgtype" />
        <ColorField label={th.bgType === 'gradient' ? 'Cor inicial do fundo' : 'Cor do fundo'} value={th.bg} onChange={setTheme('bg')} id="bg" />
        {th.bgType === 'gradient' && (
          <>
            <ColorField label="Cor final do fundo" value={th.bgColor2} onChange={setTheme('bgColor2')} id="bg2" />
            <RangeField label="Ângulo do degradê" value={th.bgAngle} min={0} max={360} step={5} suffix="°" onChange={setTheme('bgAngle')} id="bgangle" />
          </>
        )}
        <Select label="Efeito de cor no fundo" value={th.bgAnimate} options={FILL_ANIM_OPTIONS.filter(([k]) => k !== 'shimmer' && (k !== 'flow' || th.bgType === 'gradient'))} onChange={setTheme('bgAnimate')} />
        <ColorField label="Cor padrão dos textos" value={th.text} onChange={setTheme('text')} id="text" />
        <FontSelect label="Fonte padrão dos títulos" value={th.headingFont} onChange={setTheme('headingFont')} />
        <FontSelect label="Fonte padrão dos textos" value={th.bodyFont} onChange={setTheme('bodyFont')} />
        <p className="muted small">As cores e fontes padrão valem para os novos elementos. Os que já estão na página mantêm o que você escolheu neles.</p>
      </Section>
      {doc.kind === 'catalog' && <CatalogSection doc={doc} api={api} categories={categories} meta={meta} products={products} />}
      <Section title="Pesquisa (Google) e compartilhamento">
        <TextField label="Título da página" value={doc.seo.title} onChange={(v) => api.patchSeo({ title: v }, 'seo:title')} maxLength={120} id="seo-title" />
        <TextField label="Descrição curta" value={doc.seo.description} onChange={(v) => api.patchSeo({ description: v }, 'seo:desc')} multiline rows={3} maxLength={300} id="seo-desc" />
      </Section>
      <PixelSection doc={doc} api={api} />
    </div>
  );
}
