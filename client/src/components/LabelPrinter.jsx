import { useCallback, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { generateEan13 } from '../lib/barcode.js';
import { brl } from '../lib/format.js';
import {
  ELEMENT_LABELS, PRESETS, buildEntries, layoutFor, loadConfig, loadLogo, saveConfig, saveLogo,
} from '../lib/labelConfig.js';
import BarcodeSvg from './BarcodeSvg.jsx';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';
import PrintPortal from './PrintPortal.jsx';
import { useToast } from './Toast.jsx';

const PX_PER_MM = 3.7795;
const MAX_LABELS = 2000;
const SAMPLE = { key: 'sample', name: 'Camiseta Exemplo M', code: '2000000000015', priceCents: 4990 };

export function LabelView({ config, logo, entry, scale = 1, selected, onPointerDown }) {
  const { elements: el } = config;
  const mm = (value) => `${value * scale}mm`;
  const pt = (value) => `${value * scale}pt`;
  const common = (key, extra = {}) => ({
    position: 'absolute', left: mm(el[key].x), top: mm(el[key].y), margin: 0, lineHeight: 1.1, color: '#000',
    boxSizing: 'border-box', cursor: onPointerDown ? 'move' : undefined, touchAction: onPointerDown ? 'none' : undefined,
    outline: selected === key ? '1px dashed #2563eb' : undefined, ...extra,
  });
  const handlers = (key) => (onPointerDown ? { onPointerDown: (event) => onPointerDown(event, key) } : {});
  const price = entry.priceCents > 0 ? brl(entry.priceCents) : '';
  return (
    <div className="label-box" style={{
      position: 'relative', width: mm(config.width), height: mm(config.height), overflow: 'hidden', background: '#fff', fontFamily: 'Arial, Helvetica, sans-serif',
    }}>
      <div style={{ position: 'absolute', inset: 0, transform: `translate(${mm(config.offsetX)}, ${mm(config.offsetY)})` }}>
        {el.logo.visible && logo && <img src={logo} alt="" draggable={false} {...handlers('logo')} style={common('logo', { width: mm(el.logo.w), height: mm(el.logo.h), objectFit: 'contain' })} />}
        {el.name.visible && <div {...handlers('name')} style={common('name', { width: mm(el.name.w), fontSize: pt(el.name.size), fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>{entry.name}</div>}
        {el.barcode.visible && <div {...handlers('barcode')} style={common('barcode', { width: mm(el.barcode.w), height: mm(el.barcode.h) })}><BarcodeSvg code={entry.code} style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} /></div>}
        {el.code.visible && <div {...handlers('code')} style={common('code', { width: mm(el.code.w), fontSize: pt(el.code.size), textAlign: 'center', letterSpacing: '0.08em', whiteSpace: 'nowrap' })}>{entry.code}</div>}
        {el.price.visible && price && <div {...handlers('price')} style={common('price', { width: mm(el.price.w), fontSize: pt(el.price.size), fontWeight: 800, whiteSpace: 'nowrap' })}>{price}</div>}
      </div>
    </div>
  );
}

function resizeLogo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, 240 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * ratio));
      canvas.height = Math.max(1, Math.round(img.height * ratio));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler esta imagem.')); };
    img.src = url;
  });
}

const num = (value, fallback) => {
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
};

export default function LabelPrinter({ products, onClose, onChanged }) {
  const toast = useToast();
  const [config, setConfig] = useState(loadConfig);
  const [logo, setLogo] = useState(loadLogo);
  const [generated, setGenerated] = useState({});
  const [selection, setSelection] = useState({});
  const [selectedEl, setSelectedEl] = useState('name');
  const [printing, setPrinting] = useState(false);
  const [busy, setBusy] = useState(false);
  const drag = useRef(null);
  const changed = useRef(false);

  const { entries, missing } = useMemo(() => buildEntries(products, generated), [products, generated]);
  const chosen = entries.filter((entry) => selection[entry.key]?.on);
  const total = chosen.reduce((sum, entry) => sum + (selection[entry.key]?.qty || 1), 0);
  const previewEntry = chosen[0] || entries[0] || SAMPLE;
  const previewScale = Math.min(6, 300 / (config.width * PX_PER_MM));

  const update = useCallback((patch) => setConfig((current) => { const next = { ...current, ...patch }; saveConfig(next); return next; }), []);
  const updateEl = (key, patch) => setConfig((current) => {
    const next = { ...current, elements: { ...current.elements, [key]: { ...current.elements[key], ...patch } } };
    saveConfig(next);
    return next;
  });
  const applyPreset = (cols) => {
    const preset = PRESETS[cols];
    update({ ...preset, elements: layoutFor(preset.width, preset.height, config.elements) });
  };
  const resize = (patch) => {
    const width = patch.width ?? config.width;
    const height = patch.height ?? config.height;
    update({ ...patch, elements: layoutFor(width, height, config.elements) });
  };

  const onPointerDown = (event, key) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedEl(key);
    drag.current = { key, startX: event.clientX, startY: event.clientY, x: config.elements[key].x, y: config.elements[key].y };
  };
  const onPointerMove = (event) => {
    const d = drag.current;
    if (!d) return;
    const k = PX_PER_MM * previewScale;
    const round = (v) => Math.round(v * 10) / 10;
    updateEl(d.key, {
      x: Math.max(0, Math.min(config.width - 1, round(d.x + (event.clientX - d.startX) / k))),
      y: Math.max(0, Math.min(config.height - 1, round(d.y + (event.clientY - d.startY) / k))),
    });
  };
  const endDrag = () => { drag.current = null; };

  const toggle = (key, on) => setSelection((current) => ({ ...current, [key]: { qty: current[key]?.qty || 1, on } }));
  const setQty = (key, qty) => setSelection((current) => ({ ...current, [key]: { on: current[key]?.on ?? true, qty: Math.max(1, Math.min(999, Math.round(qty) || 1)) } }));
  const allOn = entries.length > 0 && entries.every((entry) => selection[entry.key]?.on);

  const generateFor = async (list) => {
    setBusy(true);
    const result = {};
    try {
      for (const product of list) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const code = generateEan13();
          try {
            await api.patch(`/products/${product.id}`, { barcode: code });
            result[product.id] = code;
            break;
          } catch (error) {
            if (attempt === 4 || !/em uso/i.test(error.message)) throw error;
          }
        }
      }
      toast(`${Object.keys(result).length} código(s) gerado(s).`);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      if (Object.keys(result).length) { changed.current = true; setGenerated((current) => ({ ...current, ...result })); }
      setBusy(false);
    }
  };

  const onLogoFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data = await resizeLogo(file);
      setLogo(data);
      saveLogo(data);
      updateEl('logo', { visible: true });
    } catch (error) { toast(error.message, 'error'); }
  };

  const labels = useMemo(() => {
    const list = [];
    for (const entry of chosen) for (let i = 0; i < (selection[entry.key]?.qty || 1); i += 1) list.push(entry);
    return list.slice(0, MAX_LABELS);
  }, [chosen, selection]);

  const print = () => {
    if (!labels.length) { toast('Marque ao menos um produto com código.', 'error'); return; }
    setPrinting(true);
  };
  const finishPrint = useCallback(() => setPrinting(false), []);

  const rows = useMemo(() => {
    const out = [];
    for (let i = 0; i < labels.length; i += config.cols) out.push(labels.slice(i, i + config.cols));
    return out;
  }, [labels, config.cols]);
  const rowWidth = config.cols * config.width + (config.cols - 1) * config.gap;
  const rollCss = `size: ${rowWidth}mm ${config.height}mm; margin: 0;`;
  const a4Css = `size: A4; margin: ${config.marginY}mm ${config.marginX}mm;`;

  const close = () => { if (changed.current) onChanged?.(); onClose(); };

  return (
    <Modal wide title="Etiquetas com código de barras" onClose={close}
      footer={<><button className="btn btn-ghost" onClick={close}>Fechar</button><button className="btn btn-primary" onClick={print} disabled={!labels.length}><Icon name="printer" size={16} /> Imprimir {total > 0 ? `${total} etiqueta${total > 1 ? 's' : ''}` : ''}</button></>}>
      <div className="lbl-layout">
        <section className="lbl-products">
          <h3>Produtos</h3>
          {entries.length > 0 && <div className="lbl-toolbar">
            <label className="check-line"><input type="checkbox" checked={allOn} onChange={(event) => setSelection(Object.fromEntries(entries.map((entry) => [entry.key, { qty: selection[entry.key]?.qty || 1, on: event.target.checked }])))} /><span>Marcar todos</span></label>
          </div>}
          <ul className="lbl-list">
            {entries.map((entry) => <li key={entry.key}>
              <label className="check-line"><input type="checkbox" checked={Boolean(selection[entry.key]?.on)} onChange={(event) => toggle(entry.key, event.target.checked)} /><span><strong>{entry.name}</strong><small className="muted"> {entry.code}</small></span></label>
              <input className="input lbl-qty" type="number" min="1" max="999" value={selection[entry.key]?.qty || 1} onChange={(event) => setQty(entry.key, Number(event.target.value))} aria-label={`Quantidade de ${entry.name}`} />
            </li>)}
            {!entries.length && <li className="muted">Nenhum produto com código de barras ainda.</li>}
          </ul>
          {missing.length > 0 && <div className="lbl-missing">
            <div className="lbl-toolbar"><strong>Sem código ({missing.length})</strong><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => generateFor(missing)}>{busy ? 'Gerando...' : 'Gerar para todos'}</button></div>
            <ul className="lbl-list">
              {missing.map((product) => <li key={product.id}><span>{product.name}</span><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => generateFor([product])}>Gerar código</button></li>)}
            </ul>
          </div>}
        </section>

        <section className="lbl-config">
          <h3>Impressora e etiqueta</h3>
          <div className="lbl-presets" role="group" aria-label="Linhas por rolo">
            {[[1, 'Linha única'], [2, 'Linha dupla'], [3, 'Linha tripla']].map(([cols, label]) => <button key={cols} type="button" className={`btn btn-sm ${config.cols === cols ? 'btn-primary' : 'btn-ghost'}`} onClick={() => applyPreset(cols)}>{label}</button>)}
          </div>
          <div className="lbl-grid">
            <label className="field"><span>Largura (mm)</span><input className="input" type="number" min="15" max="120" value={config.width} onChange={(event) => resize({ width: Math.max(15, Math.min(120, num(event.target.value, config.width))) })} /></label>
            <label className="field"><span>Altura (mm)</span><input className="input" type="number" min="10" max="120" value={config.height} onChange={(event) => resize({ height: Math.max(10, Math.min(120, num(event.target.value, config.height))) })} /></label>
            <label className="field"><span>Espaço entre (mm)</span><input className="input" type="number" min="0" max="20" value={config.gap} onChange={(event) => update({ gap: Math.max(0, num(event.target.value, config.gap)) })} /></label>
            <label className="field"><span>Papel</span><select className="input" value={config.paper} onChange={(event) => update({ paper: event.target.value })}><option value="roll">Rolo de etiquetas</option><option value="a4">Folha A4</option></select></label>
            <label className="field"><span>Ajuste horizontal (mm)</span><input className="input" type="number" step="0.5" value={config.offsetX} onChange={(event) => update({ offsetX: num(event.target.value, 0) })} /></label>
            <label className="field"><span>Ajuste vertical (mm)</span><input className="input" type="number" step="0.5" value={config.offsetY} onChange={(event) => update({ offsetY: num(event.target.value, 0) })} /></label>
            {config.paper === 'a4' && <>
              <label className="field"><span>Margem lateral (mm)</span><input className="input" type="number" min="0" value={config.marginX} onChange={(event) => update({ marginX: Math.max(0, num(event.target.value, 0)) })} /></label>
              <label className="field"><span>Margem superior (mm)</span><input className="input" type="number" min="0" value={config.marginY} onChange={(event) => update({ marginY: Math.max(0, num(event.target.value, 0)) })} /></label>
            </>}
          </div>

          <h4>Elementos <small className="muted">(arraste na prévia)</small></h4>
          <ul className="lbl-elements">
            {Object.keys(ELEMENT_LABELS).map((key) => {
              const item = config.elements[key];
              return <li key={key} className={selectedEl === key ? 'is-selected' : ''}>
                <label className="check-line"><input type="checkbox" checked={item.visible} onChange={(event) => { updateEl(key, { visible: event.target.checked }); setSelectedEl(key); }} /><span>{ELEMENT_LABELS[key]}</span></label>
                {item.visible && <div className="lbl-el-fields">
                  {'size' in item && <label><small>Fonte (pt)</small><input className="input" type="number" min="3" max="40" step="0.5" value={item.size} onChange={(event) => updateEl(key, { size: Math.max(3, Math.min(40, num(event.target.value, item.size))) })} /></label>}
                  {'w' in item && <label><small>Largura</small><input className="input" type="number" min="2" max={config.width} step="0.5" value={item.w} onChange={(event) => updateEl(key, { w: Math.max(2, num(event.target.value, item.w)) })} /></label>}
                  {'h' in item && <label><small>Altura</small><input className="input" type="number" min="2" max={config.height} step="0.5" value={item.h} onChange={(event) => updateEl(key, { h: Math.max(2, num(event.target.value, item.h)) })} /></label>}
                </div>}
                {key === 'logo' && item.visible && <div className="lbl-logo-row">
                  <label className="btn btn-ghost btn-sm">{logo ? 'Trocar logo' : 'Enviar logo'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onLogoFile} /></label>
                  {logo && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setLogo(''); saveLogo(''); }}>Remover</button>}
                </div>}
              </li>;
            })}
          </ul>
        </section>

        <section className="lbl-preview-wrap">
          <h3>Prévia</h3>
          <div className="lbl-stage" onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
            <div className="lbl-sheet"><LabelView config={config} logo={logo} entry={previewEntry} scale={previewScale} selected={selectedEl} onPointerDown={onPointerDown} /></div>
          </div>
          <small className="muted">{config.width}×{config.height} mm · {config.cols === 1 ? 'linha única' : config.cols === 2 ? 'linha dupla' : 'linha tripla'}. Selecione a impressora e o tamanho do papel na janela de impressão e desative "ajustar à página".</small>
        </section>
      </div>

      {printing && <PrintPortal pageCss={config.paper === 'a4' ? a4Css : rollCss} onDone={finishPrint}>
        {config.paper === 'a4'
          ? <div className="lbl-print-a4" style={{ gridTemplateColumns: `repeat(auto-fill, ${config.width}mm)`, gap: `${config.gap}mm` }}>{labels.map((entry, index) => <LabelView key={index} config={config} logo={logo} entry={entry} />)}</div>
          : rows.map((row, index) => <div key={index} className="lbl-print-row" style={{ width: `${rowWidth}mm`, height: `${config.height}mm`, gap: `${config.gap}mm` }}>{row.map((entry, i) => <LabelView key={i} config={config} logo={logo} entry={entry} />)}</div>)}
      </PrintPortal>}
    </Modal>
  );
}
