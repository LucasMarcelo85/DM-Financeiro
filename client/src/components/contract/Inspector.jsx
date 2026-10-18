import { useEffect, useRef, useState } from 'react';
import EIcon from './EIcon.jsx';
import VariablePicker from './VariablePicker.jsx';
import { FONTS, FONT_GROUPS, TYPE_LABELS, clamp, hasFixedHeight, isTextual } from '../../lib/contract/model.js';

const HEX = /^#[0-9a-f]{6}$/i;

function Section({ title, children }) {
  return (
    <section className="ce-sec">
      <h3>{title}</h3>
      <div className="ce-sec-body">{children}</div>
    </section>
  );
}

function NumField({ label, value, onChange, min, max, step = 1, suffix, id }) {
  const [text, setText] = useState(String(value ?? ''));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(value ?? '')); }, [value]);
  const parse = (raw) => { const n = Number(String(raw).replace(',', '.')); return raw !== '' && Number.isFinite(n) ? n : null; };
  return (
    <label className="ce-field">
      <span>{label}</span>
      <span className="ce-num">
        <input
          className="input input-sm"
          type="number"
          inputMode="decimal"
          value={text}
          min={min}
          max={max}
          step={step}
          onFocus={() => { focused.current = true; }}
          onBlur={() => {
            focused.current = false;
            const n = parse(text);
            if (n !== null) onChange(clamp(n, min, max), `num:${id || label}`);
            setText(String(n !== null ? clamp(n, min, max) : value ?? ''));
          }}
          onChange={(e) => {
            setText(e.target.value);
            const n = parse(e.target.value);
            if (n !== null && n >= min && n <= max) onChange(n, `num:${id || label}`);
          }}
        />
        {suffix && <em>{suffix}</em>}
      </span>
    </label>
  );
}

function ColorField({ label, value, onChange, allowNone, id }) {
  const none = allowNone && !value;
  const [text, setText] = useState(value || '');
  useEffect(() => setText(value || ''), [value]);
  return (
    <div className="ce-field">
      <span>{label}</span>
      <span className="ce-color">
        <input type="color" value={HEX.test(value || '') ? value : '#ffffff'} onChange={(e) => onChange(e.target.value, `color:${id || label}`)} aria-label={label} />
        <input
          className="input input-sm"
          value={none ? '' : text}
          placeholder={allowNone ? 'sem cor' : '#000000'}
          maxLength={7}
          onChange={(e) => { setText(e.target.value); if (HEX.test(e.target.value)) onChange(e.target.value.toLowerCase(), `color:${id || label}`); }}
          onBlur={() => setText(value || '')}
          aria-label={`${label} (código)`}
        />
        {allowNone && <button type="button" className={`ce-mini ${none ? 'is-on' : ''}`} onClick={() => onChange('', `color:${id || label}`)} title="Sem cor" aria-label="Sem cor"><EIcon name="x" size={14} /></button>}
      </span>
    </div>
  );
}

function Tgl({ on, onClick, title, icon, disabled }) {
  return (
    <button type="button" className={`ce-tgl ${on ? 'is-on' : ''}`} onClick={onClick} title={title} aria-label={title} aria-pressed={!!on} disabled={disabled}>
      <EIcon name={icon} size={17} />
    </button>
  );
}

export default function Inspector({ el, doc, activePageIndex, api }) {
  const caret = useRef(null); // posição do cursor no texto, para inserir variáveis ali
  const patch = (p, key) => api.patch(p, key);
  const set = (k) => (v, key) => patch({ [k]: v }, key || `k:${k}`);

  // ---------------------------------------------------------------- nada selecionado: página
  if (!el) {
    const page = doc.pages[activePageIndex] || doc.pages[0];
    return (
      <div className="ce-insp">
        <Section title={`Página ${activePageIndex + 1}`}>
          <div className="ce-field">
            <span>Orientação (todas as páginas)</span>
            <div className="seg">
              <button type="button" className={doc.orientation === 'portrait' ? 'is-on' : ''} onClick={() => api.setOrientation('portrait')}>Retrato</button>
              <button type="button" className={doc.orientation === 'landscape' ? 'is-on' : ''} onClick={() => api.setOrientation('landscape')}>Paisagem</button>
            </div>
          </div>
          <ColorField label="Cor de fundo da página" value={page.bg} onChange={(v, key) => api.setPageBg(v, key)} id="pagebg" />
        </Section>
        <Section title="Variáveis do cliente">
          <p className="muted small">Use dados do cliente no contrato. Clique para criar uma caixa de texto com a variável, ou selecione um texto antes para inserir nele.</p>
          <VariablePicker onPick={(k) => api.insertVariable(k)} />
        </Section>
        <Section title="Blocos prontos">
          <p className="muted small">Insere na página aberta. Depois arraste e edite como quiser.</p>
          <div className="ce-block-grid">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.insertBlock('header')}><EIcon name="header" size={16} /> Cabeçalho</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.insertBlock('sign')}><EIcon name="sign" size={16} /> Assinaturas</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.insertBlock('footer')}><EIcon name="footer" size={16} /> Rodapé</button>
          </div>
        </Section>
        <Section title="Dicas">
          <ul className="ce-tips">
            <li>Clique num elemento para selecionar e <strong>arraste</strong> para mover.</li>
            <li>Clique de novo num texto (ou dê dois cliques) para <strong>editar</strong>.</li>
            <li>Arraste as alças azuis para mudar o tamanho.</li>
            <li><kbd>Setas</kbd> movem 1 px (com <kbd>Shift</kbd>, 10 px). <kbd>Alt</kbd> desliga o ímã das guias.</li>
            <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> desfaz, <kbd>Ctrl</kbd>+<kbd>D</kbd> duplica, <kbd>Delete</kbd> apaga.</li>
          </ul>
        </Section>
      </div>
    );
  }

  const textual = isTextual(el.t);
  const fixedH = hasFixedHeight(el.t);

  return (
    <div className="ce-insp">
      <div className="ce-insp-head">
        <strong>{TYPE_LABELS[el.t]}</strong>
        <div className="ce-insp-actions">
          <button type="button" className="ce-mini" onClick={() => api.act('duplicate')} title="Duplicar (Ctrl+D)" aria-label="Duplicar"><EIcon name="copy" size={16} /></button>
          <button type="button" className={`ce-mini ${el.locked ? 'is-on' : ''}`} onClick={() => api.act('lock')} title={el.locked ? 'Destravar' : 'Travar posição'} aria-label={el.locked ? 'Destravar' : 'Travar posição'}><EIcon name={el.locked ? 'lock' : 'unlock'} size={16} /></button>
          <button type="button" className="ce-mini ce-mini-danger" onClick={() => api.act('delete')} title="Excluir (Delete)" aria-label="Excluir"><EIcon name="trash" size={16} /></button>
        </div>
      </div>

      {el.t === 'date' && (
        <Section title="Data">
          <div className="seg">
            <button type="button" className={el.dateMode !== 'fixed' ? 'is-on' : ''} onClick={() => patch({ dateMode: 'today' })}>Hoje (automática)</button>
            <button type="button" className={el.dateMode === 'fixed' ? 'is-on' : ''} onClick={() => patch({ dateMode: 'fixed', dateValue: el.dateValue || new Date().toISOString().slice(0, 10) })}>Data fixa</button>
          </div>
          {el.dateMode === 'fixed' && (
            <label className="ce-field"><span>Data</span><input className="input input-sm" type="date" value={el.dateValue || ''} onChange={(e) => patch({ dateValue: e.target.value }, 'date')} /></label>
          )}
          <label className="ce-field">
            <span>Formato</span>
            <select className="input input-sm" value={el.dateFormat || 'long'} onChange={(e) => patch({ dateFormat: e.target.value })}>
              <option value="long">16 de outubro de 2026</option>
              <option value="short">16 de out. de 2026</option>
              <option value="numeric">16/10/2026</option>
            </select>
          </label>
          <label className="ce-field"><span>Texto antes da data</span><input className="input input-sm" value={el.prefix || ''} maxLength={120} placeholder="Ex.: Fortaleza, " onChange={(e) => patch({ prefix: e.target.value }, 'prefix')} /></label>
          {el.dateMode !== 'fixed' && <p className="muted small">A data de hoje é atualizada toda vez que o contrato é aberto ou impresso.</p>}
        </Section>
      )}

      {textual && el.t !== 'date' && (
        <Section title="Texto">
          <textarea className="input" rows={4} value={el.text} onChange={(e) => { caret.current = e.target.selectionStart; patch({ text: e.target.value }, `txt:${el.id}`); }}
            onSelect={(e) => { caret.current = e.target.selectionStart; }} onBlur={(e) => { caret.current = e.target.selectionStart; }} aria-label="Conteúdo do texto" />
          <details className="ce-vars" open={/\{\{/.test(el.text || '')}>
            <summary>Inserir variável do cliente</summary>
            <VariablePicker onPick={(k) => api.insertVariable(k, caret.current)} />
          </details>
        </Section>
      )}

      {textual && (
        <Section title="Fonte">
          <label className="ce-field">
            <span>Fonte</span>
            <select className="input input-sm" value={el.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })}>
              {FONT_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {FONTS.filter((f) => f.group === g).map((f) => <option key={f.key} value={f.key} style={{ fontFamily: f.css }}>{f.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="ce-row">
            <NumField label="Tamanho" value={el.fontSize} onChange={set('fontSize')} min={6} max={300} suffix="px" id="fontSize" />
            <NumField label="Entrelinha" value={el.lineHeight} onChange={set('lineHeight')} min={0.8} max={3} step={0.05} id="lineHeight" />
          </div>
          <div className="ce-tgls" role="group" aria-label="Estilo do texto">
            <Tgl on={el.bold} onClick={() => patch({ bold: !el.bold })} title="Negrito" icon="bold" />
            <Tgl on={el.italic} onClick={() => patch({ italic: !el.italic })} title="Itálico" icon="italic" />
            <Tgl on={el.underline} onClick={() => patch({ underline: !el.underline })} title="Sublinhado" icon="underline" />
            <span className="ce-sep" />
            <Tgl on={el.align === 'left'} onClick={() => patch({ align: 'left' })} title="Alinhar à esquerda" icon="alignLeft" />
            <Tgl on={el.align === 'center'} onClick={() => patch({ align: 'center' })} title="Centralizar" icon="alignCenter" />
            <Tgl on={el.align === 'right'} onClick={() => patch({ align: 'right' })} title="Alinhar à direita" icon="alignRight" />
            <Tgl on={el.align === 'justify'} onClick={() => patch({ align: 'justify' })} title="Justificar" icon="alignJustify" />
          </div>
          <NumField label="Espaço entre letras" value={el.letterSpacing} onChange={set('letterSpacing')} min={-2} max={20} step={0.5} suffix="px" id="letterSpacing" />
        </Section>
      )}

      {textual && (
        <Section title="Cores e contorno">
          <ColorField label="Cor do texto" value={el.color} onChange={set('color')} id="color" />
          <ColorField label="Cor de fundo" value={el.fill} onChange={set('fill')} allowNone id="fill" />
          <ColorField label="Cor da borda" value={el.borderColor} onChange={set('borderColor')} id="borderColor" />
          <div className="ce-row">
            <NumField label="Borda" value={el.borderWidth} onChange={set('borderWidth')} min={0} max={40} suffix="px" id="borderWidth" />
            <NumField label="Cantos" value={el.radius} onChange={set('radius')} min={0} max={1000} suffix="px" id="radius" />
          </div>
          <div className="ce-row">
            <NumField label="Margem interna" value={el.padding} onChange={set('padding')} min={0} max={120} suffix="px" id="padding" />
            <NumField label="Opacidade" value={Math.round(el.opacity * 100)} onChange={(v, key) => patch({ opacity: v / 100 }, key)} min={5} max={100} suffix="%" id="opacity" />
          </div>
        </Section>
      )}

      {el.t === 'image' && (
        <Section title="Imagem">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.act('replaceImage')}><EIcon name="image" size={16} /> Trocar imagem</button>
          <label className="ce-field">
            <span>Ajuste</span>
            <select className="input input-sm" value={el.fit || 'contain'} onChange={(e) => patch({ fit: e.target.value })}>
              <option value="contain">Mostrar inteira</option>
              <option value="cover">Preencher (corta as bordas)</option>
              <option value="fill">Esticar</option>
            </select>
          </label>
          <ColorField label="Cor da borda" value={el.borderColor} onChange={set('borderColor')} id="borderColor" />
          <div className="ce-row">
            <NumField label="Borda" value={el.borderWidth} onChange={set('borderWidth')} min={0} max={40} suffix="px" id="borderWidth" />
            <NumField label="Cantos" value={el.radius} onChange={set('radius')} min={0} max={1000} suffix="px" id="radius" />
          </div>
          <NumField label="Opacidade" value={Math.round(el.opacity * 100)} onChange={(v, key) => patch({ opacity: v / 100 }, key)} min={5} max={100} suffix="%" id="opacity" />
        </Section>
      )}

      {el.t === 'line' && (
        <Section title="Linha">
          <ColorField label="Cor" value={el.color} onChange={set('color')} id="color" />
          <div className="ce-row">
            <NumField label="Espessura" value={el.h} onChange={set('h')} min={1} max={40} suffix="px" id="thick" />
            <label className="ce-field">
              <span>Estilo</span>
              <select className="input input-sm" value={el.lineStyle || 'solid'} onChange={(e) => patch({ lineStyle: e.target.value })}>
                <option value="solid">Contínua</option>
                <option value="dashed">Tracejada</option>
                <option value="dotted">Pontilhada</option>
              </select>
            </label>
          </div>
          <NumField label="Opacidade" value={Math.round(el.opacity * 100)} onChange={(v, key) => patch({ opacity: v / 100 }, key)} min={5} max={100} suffix="%" id="opacity" />
        </Section>
      )}

      {el.t === 'shape' && (
        <Section title="Retângulo">
          <ColorField label="Cor de fundo" value={el.fill} onChange={set('fill')} allowNone id="fill" />
          <ColorField label="Cor da borda" value={el.borderColor} onChange={set('borderColor')} id="borderColor" />
          <div className="ce-row">
            <NumField label="Borda" value={el.borderWidth} onChange={set('borderWidth')} min={0} max={40} suffix="px" id="borderWidth" />
            <NumField label="Cantos" value={el.radius} onChange={set('radius')} min={0} max={1000} suffix="px" id="radius" />
          </div>
          <NumField label="Opacidade" value={Math.round(el.opacity * 100)} onChange={(v, key) => patch({ opacity: v / 100 }, key)} min={5} max={100} suffix="%" id="opacity" />
        </Section>
      )}

      <Section title="Posição e layout">
        <div className="ce-row">
          <NumField label="X" value={el.x} onChange={set('x')} min={-2000} max={4000} id="x" />
          <NumField label="Y" value={el.y} onChange={set('y')} min={-2000} max={4000} id="y" />
        </div>
        <div className="ce-row">
          <NumField label="Largura" value={el.w} onChange={set('w')} min={2} max={3000} id="w" />
          {fixedH && el.t !== 'line' && <NumField label="Altura" value={el.h} onChange={set('h')} min={2} max={3000} id="h" />}
        </div>
        <div className="ce-field">
          <span>Alinhar na página</span>
          <div className="ce-tgls">
            <Tgl onClick={() => api.act('align:left')} title="À esquerda" icon="pageLeft" />
            <Tgl onClick={() => api.act('align:center')} title="Centro (horizontal)" icon="pageCenterX" />
            <Tgl onClick={() => api.act('align:right')} title="À direita" icon="pageRight" />
            <span className="ce-sep" />
            <Tgl onClick={() => api.act('align:top')} title="Topo" icon="pageTop" />
            <Tgl onClick={() => api.act('align:middle')} title="Centro (vertical)" icon="pageCenterY" />
            <Tgl onClick={() => api.act('align:bottom')} title="Base" icon="pageBottom" />
          </div>
        </div>
        <div className="ce-field">
          <span>Camadas</span>
          <div className="ce-row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.act('front')}><EIcon name="front" size={16} /> Para frente</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.act('back')}><EIcon name="back2" size={16} /> Para trás</button>
          </div>
        </div>
      </Section>
    </div>
  );
}
