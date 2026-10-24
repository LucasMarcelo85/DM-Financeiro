import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import { resizeBox } from '../../lib/portfolio/geometry.js';
import { cropImage, loadImage, pickColor, removeImageBackground, resizeImage } from '../../lib/portfolio/imageTools.js';

// Ferramentas da imagem: recortar, remover fundo e dimensionar. Cada uma gera uma nova imagem que substitui a atual.
const RATIOS = [['free', 'Livre', 0], ['1', 'Quadrado', 1], ['4:3', '4:3', 4 / 3], ['3:4', '3:4', 3 / 4], ['16:9', '16:9', 16 / 9], ['9:16', '9:16', 9 / 16]];
const TABS = [['crop', 'Recortar'], ['bg', 'Remover fundo'], ['size', 'Dimensionar']];

export default function ImageEditor({ src, initial = 'crop', onApply, onClose }) {
  const [tab, setTab] = useState(initial);
  const [img, setImg] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadImage(src).then(setImg).catch((e) => setError(e.message)); }, [src]);

  async function run(fn) {
    setBusy(true); setError('');
    try { onApply(await fn()); onClose(); } catch (e) { setError(e.message || 'Não foi possível aplicar.'); setBusy(false); }
  }

  return (
    <Modal title="Editar imagem" onClose={onClose} wide>
      <div className="seg pe-ie-tabs" role="tablist" aria-label="Ferramenta" style={{ '--n': 3 }}>
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {!img ? <p className="muted">{error || 'Abrindo a imagem...'}</p> : (
        <>
          {tab === 'crop' && <CropTool img={img} src={src} busy={busy} onApply={(rect) => run(() => cropImage(src, rect).then((r) => r.src))} />}
          {tab === 'bg' && <BgTool src={src} busy={busy} onApply={(opts) => run(() => removeImageBackground(src, opts).then((r) => r.src))} />}
          {tab === 'size' && <SizeTool img={img} src={src} busy={busy} onApply={(w, h, q) => run(() => resizeImage(src, w, h, q).then((r) => r.src))} />}
        </>
      )}
      {error && img && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------- recortar
function CropTool({ img, src, busy, onApply }) {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const [ratio, setRatio] = useState('free');
  const [rect, setRect] = useState({ x: 0, y: 0, w: nw, h: nh });
  const box = useRef(null);
  const drag = useRef(null);
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const ratioVal = RATIOS.find((r) => r[0] === ratio)[2];

  const fit = useCallback((r, v) => { // aplica a proporção escolhida mantendo o centro
    if (!v) return r;
    let w = r.w; let h = w / v;
    if (h > nh) { h = nh; w = h * v; }
    if (w > nw) { w = nw; h = w / v; }
    return { w, h, x: Math.min(Math.max(0, r.x + (r.w - w) / 2), nw - w), y: Math.min(Math.max(0, r.y + (r.h - h) / 2), nh - h) };
  }, [nw, nh]);

  useEffect(() => { setRect((r) => fit(r, ratioVal)); }, [ratioVal, fit]);

  const k = () => (box.current ? box.current.getBoundingClientRect().width / nw : 1); // pixels da tela por pixel da imagem

  function down(kind, handle, e) {
    e.preventDefault(); e.stopPropagation();
    drag.current = { kind, handle, sx: e.clientX, sy: e.clientY, r: { ...rectRef.current } };
    const mv = (ev) => {
      const d = drag.current; if (!d) return;
      const dx = (ev.clientX - d.sx) / k(); const dy = (ev.clientY - d.sy) / k();
      if (d.kind === 'move') {
        setRect({ ...d.r, x: Math.min(Math.max(0, d.r.x + dx), nw - d.r.w), y: Math.min(Math.max(0, d.r.y + dy), nh - d.r.h) });
      } else {
        const r = resizeBox({ ...d.r, r: 0 }, d.handle, dx, dy, { keepRatio: Boolean(ratioVal) && d.handle.length === 2, minW: 20, minH: 20 });
        let { x, y, w, h } = r;
        if (ratioVal && d.handle.length === 1) { // lados: ajusta o outro eixo para manter a proporção
          if (d.handle === 'e' || d.handle === 'w') { h = w / ratioVal; y = d.r.y + (d.r.h - h) / 2; } else { w = h * ratioVal; x = d.r.x + (d.r.w - w) / 2; }
        }
        x = Math.max(0, x); y = Math.max(0, y); w = Math.min(w, nw - x); h = Math.min(h, nh - y);
        if (ratioVal) { const wh = Math.min(w, h * ratioVal); w = wh; h = wh / ratioVal; }
        setRect({ x, y, w, h });
      }
    };
    const up = () => { drag.current = null; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }

  const pct = (n, total) => `${(n / total) * 100}%`;
  return (
    <div className="pe-ie">
      <div className="pe-ie-opts">
        {RATIOS.map(([key, label]) => <button key={key} type="button" className={`pe-chip${ratio === key ? ' is-on' : ''}`} onClick={() => setRatio(key)}>{label}</button>)}
      </div>
      <div className="pe-crop" ref={box} style={{ aspectRatio: `${nw} / ${nh}` }}>
        <img src={src} alt="" draggable={false} />
        <div className="pe-crop-rect" style={{ left: pct(rect.x, nw), top: pct(rect.y, nh), width: pct(rect.w, nw), height: pct(rect.h, nh) }} onPointerDown={(e) => down('move', null, e)}>
          {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => <b key={h} className={`pe-crop-h h-${h}`} onPointerDown={(e) => down('resize', h, e)} />)}
        </div>
      </div>
      <p className="muted small">Área escolhida: {Math.round(rect.w)} × {Math.round(rect.h)} px (a imagem tem {nw} × {nh}). Arraste o quadro e as bolinhas.</p>
      <div className="btn-row"><button type="button" className="btn btn-primary" disabled={busy} onClick={() => onApply(rect)}>{busy ? 'Aplicando...' : 'Aplicar recorte'}</button></div>
    </div>
  );
}

// ---------------------------------------------------------------- remover fundo
function BgTool({ src, busy, onApply }) {
  const [tol, setTol] = useState(30);
  const [feather, setFeather] = useState(1);
  const [contiguous, setContiguous] = useState(true);
  const [seed, setSeed] = useState(null);
  const [preview, setPreview] = useState('');
  const [working, setWorking] = useState(false);
  const timer = useRef(null);
  const frame = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setWorking(true);
      try { setPreview((await removeImageBackground(src, { tolerance: tol, feather, contiguous, seed, maxDim: 700 })).src); } catch { /* mantém a prévia anterior */ } finally { setWorking(false); }
    }, 200);
    return () => clearTimeout(timer.current);
  }, [src, tol, feather, contiguous, seed]);

  async function pick(e) {
    const r = frame.current.getBoundingClientRect();
    setSeed(await pickColor(src, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height));
  }
  return (
    <div className="pe-ie">
      <p className="muted small">Funciona melhor com fundo de uma cor só (foto de produto em fundo branco ou liso). Clique na imagem para escolher a cor que será removida.</p>
      <div className="pe-bgprev" ref={frame} onClick={pick} role="presentation" title="Clique para escolher a cor do fundo">
        <img src={preview || src} alt="Prévia sem fundo" draggable={false} />
        {working && <span className="pe-bgprev-busy">Calculando...</span>}
      </div>
      <div className="pe-ie-opts">
        <span className="pe-swatch" style={{ background: seed ? `rgb(${seed.join(',')})` : 'transparent' }} aria-hidden="true" />
        <span className="small">{seed ? 'Cor escolhida' : 'Cor do fundo: automática (bordas da imagem)'}</span>
        {seed && <button type="button" className="link-btn" onClick={() => setSeed(null)}>Automática</button>}
      </div>
      <label className="ce-field"><span>Tolerância: {tol}</span><input type="range" className="pe-range" min={0} max={100} value={tol} onChange={(e) => setTol(Number(e.target.value))} /></label>
      <label className="ce-field"><span>Suavizar bordas: {feather}</span><input type="range" className="pe-range" min={0} max={4} value={feather} onChange={(e) => setFeather(Number(e.target.value))} /></label>
      <label className="pe-check"><input type="checkbox" checked={contiguous} onChange={(e) => setContiguous(e.target.checked)} /><span>Remover só o fundo ligado às bordas (mantém partes iguais por dentro do objeto)</span></label>
      <div className="btn-row"><button type="button" className="btn btn-primary" disabled={busy || working} onClick={() => onApply({ tolerance: tol, feather, contiguous, seed })}>{busy ? 'Aplicando...' : 'Remover fundo'}</button></div>
    </div>
  );
}

// ---------------------------------------------------------------- dimensionar
const PRESETS = [['Pequena', 600], ['Média', 1000], ['Grande', 1600]];
function SizeTool({ img, onApply, busy }) {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const [w, setW] = useState(nw);
  const [h, setH] = useState(nh);
  const [lock, setLock] = useState(true);
  const [fmt, setFmt] = useState('image/png');
  const setWidth = (v) => { const n = Math.max(1, Math.min(4000, Number(v) || 1)); setW(n); if (lock) setH(Math.max(1, Math.round((n * nh) / nw))); };
  const setHeight = (v) => { const n = Math.max(1, Math.min(4000, Number(v) || 1)); setH(n); if (lock) setW(Math.max(1, Math.round((n * nw) / nh))); };
  const preset = (side) => { const k = side / Math.max(nw, nh); setW(Math.round(nw * k)); setH(Math.round(nh * k)); };
  return (
    <div className="pe-ie">
      <p className="muted small">Imagem atual: {nw} × {nh} px. Reduzir o tamanho deixa a página mais leve e rápida.</p>
      <div className="pe-ie-opts">{PRESETS.map(([l, s]) => <button key={l} type="button" className="pe-chip" onClick={() => preset(s)}>{l} ({s}px)</button>)}</div>
      <div className="grid-2">
        <label className="ce-field"><span>Largura (px)</span><input className="input input-sm" type="number" min={1} max={4000} value={w} onChange={(e) => setWidth(e.target.value)} /></label>
        <label className="ce-field"><span>Altura (px)</span><input className="input input-sm" type="number" min={1} max={4000} value={h} onChange={(e) => setHeight(e.target.value)} /></label>
      </div>
      <label className="pe-check"><input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /><span>Manter a proporção</span></label>
      <div className="ce-field"><span>Formato</span>
        <div className="seg pe-seg" style={{ '--n': 2 }} role="radiogroup" aria-label="Formato">
          <button type="button" role="radio" aria-checked={fmt === 'image/png'} className={fmt === 'image/png' ? 'is-on' : ''} onClick={() => setFmt('image/png')}>PNG (com transparência)</button>
          <button type="button" role="radio" aria-checked={fmt === 'image/jpeg'} className={fmt === 'image/jpeg' ? 'is-on' : ''} onClick={() => setFmt('image/jpeg')}>JPG (mais leve)</button>
        </div>
      </div>
      <p className="muted small">Novo tamanho: {w} × {h} px.</p>
      <div className="btn-row"><button type="button" className="btn btn-primary" disabled={busy || (w === nw && h === nh && fmt === 'image/png')} onClick={() => onApply(w, h, { type: fmt, quality: 0.88 })}>{busy ? 'Aplicando...' : 'Aplicar tamanho'}</button></div>
    </div>
  );
}
