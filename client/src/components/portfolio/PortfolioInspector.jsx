import { useEffect, useState } from 'react';
import EIcon from '../contract/EIcon.jsx';
import { Check, ColorField, GalleryField, ImageField, LinkFields, RangeField, Section, Seg, TextField } from './Fields.jsx';
import {
  ALIGN_OPTIONS, BLOCK_LABELS, FONTS, FONT_GROUPS, MAX_GALLERY, RADIUS_OPTIONS, THEME_PRESETS, WIDTH_OPTIONS, pageUrl, parseVideo, uid,
} from '../../lib/portfolio/model.js';

const SIZE_H = [['sm', 'P'], ['md', 'M'], ['lg', 'G'], ['xl', 'GG']];
const SIZE_T = [['sm', 'Pequeno'], ['md', 'Médio'], ['lg', 'Grande']];
const IMG_W = [['sm', 'P'], ['md', 'M'], ['lg', 'G'], ['full', 'Total']];
const IMG_R = [['none', 'Reto'], ['soft', 'Suave'], ['round', 'Redondo']];
const BANNER_H = [['sm', 'Baixo'], ['md', 'Médio'], ['lg', 'Alto']];
const BTN_STYLE = [['solid', 'Cheio'], ['outline', 'Contorno'], ['soft', 'Suave']];
const LINE = [['solid', 'Contínua'], ['dashed', 'Tracejada'], ['dotted', 'Pontilhada']];

const FontSelect = ({ label, value, onChange }) => (
  <label className="ce-field">
    <span>{label}</span>
    <select className="input input-sm" value={value} onChange={(e) => onChange(e.target.value, `font:${label}`)}>
      {FONT_GROUPS.map((g) => (
        <optgroup key={g} label={g}>{FONTS.filter((f) => f.group === g).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</optgroup>
      ))}
    </select>
  </label>
);

// Endereço da página: a principal fica em dominio/usuário; as outras ganham um complemento que o usuário pode trocar.
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

function PageSettings({ doc, meta, api }) {
  const th = doc.theme;
  const setTheme = (k) => (v, key) => api.patchTheme({ [k]: v }, key || `theme:${k}`);
  const preset = THEME_PRESETS.find((p) => p.primary === th.primary && p.bg === th.bg && p.text === th.text);
  return (
    <div className="ce-insp">
      <Section title="Cor do tema">
        <div className="pe-presets" role="group" aria-label="Combinações de cores">
          {THEME_PRESETS.map((p) => (
            <button key={p.key} type="button" className={`pe-preset ${preset?.key === p.key ? 'is-on' : ''}`} style={{ '--pp': p.primary, '--pb': p.bg }}
              onClick={() => api.patchTheme({ primary: p.primary, bg: p.bg, text: p.text }, `preset:${p.key}`)}>
              <i /> {p.label}
            </button>
          ))}
        </div>
        <ColorField label="Cor principal (botões e banner)" value={th.primary} onChange={setTheme('primary')} id="primary" />
        <ColorField label="Cor de fundo da página" value={th.bg} onChange={setTheme('bg')} id="bg" />
        <ColorField label="Cor dos textos" value={th.text} onChange={setTheme('text')} id="text" />
      </Section>

      <Section title="Fontes e formato">
        <FontSelect label="Fonte dos títulos" value={th.headingFont} onChange={setTheme('headingFont')} />
        <FontSelect label="Fonte dos textos" value={th.bodyFont} onChange={setTheme('bodyFont')} />
        <Seg label="Cantos dos botões e imagens" value={th.radius} options={RADIUS_OPTIONS} onChange={setTheme('radius')} id="radius" />
        <Seg label="Largura do conteúdo" value={th.width} options={WIDTH_OPTIONS} onChange={setTheme('width')} id="width" />
      </Section>

      <AddressSection meta={meta} onSaveSlug={api.saveSlug} onCopy={api.copyLink} />

      <Section title="Ao enviar o link">
        <p className="muted small">É o título e a descrição que aparecem quando você manda o link pelo WhatsApp, redes sociais e no Google.</p>
        <TextField label="Título" value={doc.seo.title} maxLength={120} placeholder="Nome da empresa ou da página" id="seo-title" onChange={(v, k) => api.patchSeo({ title: v }, k)} />
        <TextField label="Descrição" multiline rows={3} value={doc.seo.description} maxLength={300} placeholder="Uma frase sobre o que você faz" id="seo-desc" onChange={(v, k) => api.patchSeo({ description: v }, k)} hint={`${doc.seo.description.length}/300`} />
      </Section>

      <Section title="Dicas">
        <ul className="ce-tips">
          <li>Use a barra à esquerda para <strong>adicionar blocos</strong>. Clique num bloco da página para editar.</li>
          <li><strong>Arraste</strong> pelo ícone de pontinhos ou use as setas para mudar a ordem.</li>
          <li>Teste em <strong>Celular</strong> e <strong>Computador</strong> no topo. A página se adapta sozinha.</li>
          <li>Só aparece na internet depois de <strong>Publicar</strong>. Antes disso, só você vê.</li>
          <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> desfaz, <kbd>Ctrl</kbd>+<kbd>D</kbd> duplica, <kbd>Delete</kbd> apaga.</li>
        </ul>
      </Section>
    </div>
  );
}

function VideoStatus({ url }) {
  if (!url) return <p className="pe-hint">Cole o link do vídeo (YouTube, Vimeo ou um arquivo .mp4).</p>;
  return parseVideo(url)
    ? <p className="pe-hint is-ok">Vídeo reconhecido.</p>
    : <p className="pe-hint is-warn">Link não reconhecido. Use um link https do YouTube, Vimeo ou de um arquivo .mp4, .webm ou .ogg.</p>;
}

export default function PortfolioInspector({ block, doc, meta, index, count, api }) {
  if (!block) return <PageSettings doc={doc} meta={meta} api={api} />;

  const b = block;
  const set = (k) => (v, key) => api.patch({ [k]: v }, key || `${b.id}:${k}`);
  const setAll = (patch, key) => api.patch(patch, key);
  const err = (m) => api.toast(m, 'error');

  return (
    <div className="ce-insp">
      <div className="ce-insp-head">
        <strong>{BLOCK_LABELS[b.t]}</strong>
        <div className="ce-insp-actions">
          <button type="button" className="ce-mini" onClick={() => api.act('up')} disabled={index <= 0} title="Subir" aria-label="Subir bloco"><EIcon name="up" size={16} /></button>
          <button type="button" className="ce-mini" onClick={() => api.act('down')} disabled={index >= count - 1} title="Descer" aria-label="Descer bloco"><EIcon name="down" size={16} /></button>
          <button type="button" className="ce-mini" onClick={() => api.act('duplicate')} title="Duplicar (Ctrl+D)" aria-label="Duplicar"><EIcon name="copy" size={16} /></button>
          <button type="button" className="ce-mini ce-mini-danger" onClick={() => api.act('delete')} title="Excluir (Delete)" aria-label="Excluir"><EIcon name="trash" size={16} /></button>
        </div>
      </div>

      {b.t === 'banner' && (
        <>
          <Section title="Conteúdo">
            <TextField label="Título" value={b.title} maxLength={200} onChange={set('title')} id={`${b.id}-title`} />
            <TextField label="Subtítulo" multiline rows={3} value={b.subtitle} maxLength={600} onChange={set('subtitle')} id={`${b.id}-sub`} />
          </Section>
          <Section title="Imagem e cores">
            <ImageField label="Imagem de fundo" value={b.image} maxDim={1800} onChange={set('image')} onError={err} />
            <ColorField label="Cor de fundo (sem imagem)" value={b.bgColor} allowNone onChange={set('bgColor')} id={`${b.id}-bg`} />
            <RangeField label="Escurecer a imagem" value={b.overlay} min={0} max={0.9} step={0.05} onChange={set('overlay')} format={(v) => `${Math.round(v * 100)}%`} id={`${b.id}-ov`} />
            <ColorField label="Cor do escurecimento" value={b.overlayColor} onChange={set('overlayColor')} id={`${b.id}-ovc`} />
            <ColorField label="Cor do texto" value={b.textColor} onChange={set('textColor')} id={`${b.id}-tc`} />
          </Section>
          <Section title="Formato">
            <Seg label="Altura" value={b.height} options={BANNER_H} onChange={set('height')} id={`${b.id}-h`} />
            <Seg label="Alinhamento do texto" value={b.align} options={ALIGN_OPTIONS} onChange={set('align')} id={`${b.id}-a`} />
          </Section>
          <Section title="Botão do banner">
            <Check label="Mostrar botão" checked={b.showButton} onChange={(v) => setAll({ showButton: v })} />
            {b.showButton && (
              <>
                <TextField label="Texto do botão" value={b.buttonLabel} maxLength={80} onChange={set('buttonLabel')} id={`${b.id}-bl`} />
                <LinkFields link={b.link} onChange={(l, key) => setAll({ link: l }, key)} id={b.id} />
              </>
            )}
          </Section>
        </>
      )}

      {b.t === 'logo' && (
        <Section title="Logo">
          <ImageField label="Imagem da logo" value={b.src} maxDim={800} onChange={set('src')} onError={err} />
          <RangeField label="Altura" value={b.size} min={24} max={240} step={4} suffix=" px" onChange={set('size')} id={`${b.id}-size`} />
          <Seg label="Alinhamento" value={b.align} options={ALIGN_OPTIONS} onChange={set('align')} id={`${b.id}-a`} />
        </Section>
      )}

      {b.t === 'heading' && (
        <Section title="Título">
          <TextField label="Texto" value={b.text} maxLength={300} onChange={set('text')} id={`${b.id}-t`} />
          <Seg label="Tamanho" value={b.size} options={SIZE_H} onChange={set('size')} id={`${b.id}-s`} />
          <Seg label="Alinhamento" value={b.align} options={ALIGN_OPTIONS} onChange={set('align')} id={`${b.id}-a`} />
          <ColorField label="Cor" value={b.color} allowNone onChange={set('color')} id={`${b.id}-c`} />
        </Section>
      )}

      {b.t === 'text' && (
        <Section title="Texto">
          <TextField label="Conteúdo" multiline rows={7} value={b.text} maxLength={8000} onChange={set('text')} id={`${b.id}-t`} hint="Enter cria uma nova linha. Dica: comece linhas com • para fazer uma lista." />
          <Seg label="Tamanho" value={b.size} options={SIZE_T} onChange={set('size')} id={`${b.id}-s`} />
          <Seg label="Alinhamento" value={b.align} options={ALIGN_OPTIONS} onChange={set('align')} id={`${b.id}-a`} />
          <ColorField label="Cor" value={b.color} allowNone onChange={set('color')} id={`${b.id}-c`} />
        </Section>
      )}

      {b.t === 'image' && (
        <Section title="Imagem">
          <ImageField label="Arquivo" value={b.src} maxDim={1600} onChange={set('src')} onError={err} />
          <TextField label="Descrição da imagem (acessibilidade)" value={b.alt} maxLength={160} onChange={set('alt')} id={`${b.id}-alt`} />
          <TextField label="Legenda (opcional)" value={b.caption} maxLength={300} onChange={set('caption')} id={`${b.id}-cap`} />
          <Seg label="Largura" value={b.width} options={IMG_W} onChange={set('width')} id={`${b.id}-w`} />
          <Seg label="Cantos" value={b.radius} options={IMG_R} onChange={set('radius')} id={`${b.id}-r`} />
          <Seg label="Alinhamento" value={b.align} options={ALIGN_OPTIONS} onChange={set('align')} id={`${b.id}-a`} />
        </Section>
      )}

      {b.t === 'gallery' && (
        <Section title="Galeria">
          <GalleryField items={b.items} max={MAX_GALLERY} onError={err}
            onAdd={(srcs) => setAll({ items: [...b.items, ...srcs.map((src) => ({ id: uid(), src, alt: '' }))].slice(0, MAX_GALLERY) })}
            onRemove={(id) => setAll({ items: b.items.filter((it) => it.id !== id) })} />
          <Seg label="Colunas (no computador)" value={b.cols} options={[[2, '2'], [3, '3'], [4, '4']]} onChange={set('cols')} id={`${b.id}-cols`} />
          <Seg label="Cantos" value={b.radius} options={IMG_R} onChange={set('radius')} id={`${b.id}-r`} />
          <p className="muted small">No celular a galeria mostra 2 colunas.</p>
        </Section>
      )}

      {b.t === 'video' && (
        <Section title="Vídeo">
          <TextField label="Link do vídeo" value={b.url} maxLength={600} placeholder="https://www.youtube.com/watch?v=..." onChange={set('url')} id={`${b.id}-url`} />
          <VideoStatus url={b.url} />
          <TextField label="Legenda (opcional)" value={b.caption} maxLength={300} onChange={set('caption')} id={`${b.id}-cap`} />
          <Seg label="Largura" value={b.width} options={IMG_W} onChange={set('width')} id={`${b.id}-w`} />
        </Section>
      )}

      {b.t === 'button' && (
        <>
          <Section title="Botão">
            <TextField label="Texto do botão" value={b.label} maxLength={80} onChange={set('label')} id={`${b.id}-l`} />
            <Seg label="Estilo" value={b.style} options={BTN_STYLE} onChange={set('style')} id={`${b.id}-st`} />
            <Seg label="Tamanho" value={b.size} options={[['md', 'Normal'], ['lg', 'Grande']]} onChange={set('size')} id={`${b.id}-sz`} />
            <Seg label="Alinhamento" value={b.align} options={ALIGN_OPTIONS} onChange={set('align')} id={`${b.id}-a`} />
            <Check label="Ocupar a largura toda" checked={b.full} onChange={(v) => setAll({ full: v })} />
            <ColorField label="Cor do botão" value={b.color} allowNone onChange={set('color')} id={`${b.id}-c`} />
          </Section>
          <Section title="Link do botão">
            <LinkFields link={b.link} onChange={(l, key) => setAll({ link: l }, key)} id={b.id} />
          </Section>
        </>
      )}

      {b.t === 'divider' && (
        <Section title="Divisor">
          <Seg label="Estilo da linha" value={b.style} options={LINE} onChange={set('style')} id={`${b.id}-st`} />
          <ColorField label="Cor" value={b.color} allowNone onChange={set('color')} id={`${b.id}-c`} />
        </Section>
      )}

      {b.t === 'spacer' && (
        <Section title="Espaço em branco">
          <RangeField label="Altura" value={b.height} min={4} max={240} step={4} suffix=" px" onChange={set('height')} id={`${b.id}-h`} />
        </Section>
      )}
    </div>
  );
}
