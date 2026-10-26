import { useCallback, useEffect, useRef, useState } from 'react';
import PortfolioCanvas, { ClipDefs } from './Canvas.jsx';
import { DESIGN_W, autoHeight, boxOf, pageHeight } from '../../lib/portfolio/doc.js';
import { HANDLES, angleTo, resizeBox, snapMove } from '../../lib/portfolio/geometry.js';

// Palco do editor livre: arrastar, redimensionar (8 alças), girar, ajuste magnético às guias, soltar elementos e imagens.
// Tudo é calculado em pixels do "projeto" do dispositivo; `zoom` só muda o tamanho na tela.

const HANDLE_CURSOR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
const HANDLE_POS = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] };

export default function Stage({ doc, device, zoom, selectedId, products, animate, replay, onSelect, onBox, onDropType, onDropFile, onEdit, onInteract }) {
  const canvasWrap = useRef(null);
  const drag = useRef(null);
  const [guides, setGuides] = useState({ x: [], y: [] });
  const [readout, setReadout] = useState(null);
  const latest = useRef({});
  latest.current = { doc, device, zoom, onBox, onInteract };

  const W = DESIGN_W[device];
  const H = pageHeight(doc, device);
  const selected = selectedId ? doc.elements.find((e) => e.id === selectedId) : null;
  const sbox = selected ? boxOf(selected, device) : null;
  const interactive = selected && !selected.locked && !sbox?.hide;

  // posição do ponteiro em pixels do projeto
  const toDesign = useCallback((e) => {
    const rect = canvasWrap.current.querySelector('[data-canvas]').getBoundingClientRect();
    const z = latest.current.zoom;
    return { x: (e.clientX - rect.left) / z, y: (e.clientY - rect.top) / z };
  }, []);

  const finish = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    setGuides({ x: [], y: [] });
    setReadout(null);
    window.removeEventListener('pointermove', move); // eslint-disable-line no-use-before-define
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    latest.current.onInteract?.(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const move = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    const { doc: dc, device: dv, zoom: z } = latest.current;
    const p = toDesign(e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) * z < 3) return; // pequeno tremor do dedo/mouse não conta como arrastar
    d.moved = true;
    const Wd = DESIGN_W[dv];
    const Hd = pageHeight(dc, dv);
    const others = dc.elements.filter((x) => x.id !== d.id && !boxOf(x, dv).hide).map((x) => boxOf(x, dv));
    let patch;
    if (d.kind === 'move') {
      let nx = d.box.x + dx;
      let ny = d.box.y + dy;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) ny = d.box.y; else nx = d.box.x; } // Shift: só na horizontal ou só na vertical
      let g = { x: [], y: [] };
      if (!e.altKey) {
        const s = snapMove({ ...d.box, x: nx, y: ny }, others, Wd, Hd, 7 / z);
        nx = s.x; ny = s.y; g = s.guides;
      }
      patch = { x: Math.round(nx), y: Math.round(ny) };
      setGuides(g);
    } else if (d.kind === 'resize') {
      const r = resizeBox(d.box, d.handle, dx, dy, { keepRatio: d.ratio !== e.shiftKey, centered: e.altKey });
      patch = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
      if (autoHeight(d.el)) delete patch.h; // a altura é calculada
    } else {
      const c = { x: d.box.x + d.box.w / 2, y: d.box.y + d.box.h / 2 };
      patch = { r: angleTo(c, p, e.shiftKey) };
    }
    setReadout(d.kind === 'rotate' ? `${patch.r}°` : `${patch.x ?? d.box.x}, ${patch.y ?? d.box.y} · ${patch.w ?? d.box.w}×${patch.h ?? d.box.h}`);
    latest.current.onBox(d.id, patch, `drag:${d.id}:${d.kind}`);
  }, [toDesign]);

  useEffect(() => () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); }, [move, finish]);

  function begin(kind, el, e, handle) {
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation();
    if (kind !== 'move') e.preventDefault();
    const box = { ...boxOf(el, device) };
    drag.current = { kind, id: el.id, el, box, handle, start: toDesign(e), moved: false, ratio: el.t === 'image' && handle && handle.length === 2 };
    onInteract?.(true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }

  function onCanvasDown(e) {
    const node = e.target.closest?.('[data-el]');
    if (!node) { onSelect(null); return; }
    const el = doc.elements.find((x) => x.id === node.dataset.el);
    if (!el) return;
    onSelect(el.id);
    if (!el.locked) begin('move', el, e);
  }

  function onDragOver(e) { if ([...e.dataTransfer.types].some((t) => t === 'text/pv-type' || t === 'Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }
  function onDrop(e) {
    const p = toDesign(e);
    const type = e.dataTransfer.getData('text/pv-type');
    if (type) { e.preventDefault(); onDropType?.(type, p.x, p.y); return; }
    const file = [...(e.dataTransfer.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); onDropFile?.(file, p.x, p.y); }
  }

  const hs = 11 / zoom; // alças com tamanho fixo na tela
  const bw = 1.5 / zoom;
  const accent = '#2563eb';

  return (
    <div ref={canvasWrap} className="pe-stage-canvas" onPointerDown={onCanvasDown} onDoubleClick={(e) => { const n = e.target.closest?.('[data-el]'); if (n) onEdit?.(n.dataset.el); }} onDragOver={onDragOver} onDrop={onDrop}>
      <ClipDefs />
      <PortfolioCanvas doc={doc} device={device} scale={zoom} mode="edit" animate={animate} replay={replay} products={products}>
        {guides.x.map((x) => <i key={`gx${x}`} className="pe-guide is-v" style={{ left: x, height: H, width: 1 / zoom }} />)}
        {guides.y.map((y) => <i key={`gy${y}`} className="pe-guide is-h" style={{ top: y, width: W, height: 1 / zoom }} />)}
        {sbox && (
          <div className={`pe-sel${selected.locked ? ' is-locked' : ''}`}
            style={{ left: sbox.x, top: sbox.y, width: sbox.w, height: selected.t === 'products' ? sbox.h : sbox.h, transform: sbox.r ? `rotate(${sbox.r}deg)` : undefined, outline: `${bw}px solid ${accent}`, zIndex: 9999, pointerEvents: 'none' }}>
            {interactive && HANDLES.map((h) => (
              <b key={h} className="pe-handle" role="presentation"
                style={{ left: `${HANDLE_POS[h][0]}%`, top: `${HANDLE_POS[h][1]}%`, width: hs, height: hs, marginLeft: -hs / 2, marginTop: -hs / 2, cursor: HANDLE_CURSOR[h], borderWidth: bw, borderColor: accent, pointerEvents: 'auto' }}
                onPointerDown={(e) => begin('resize', selected, e, h)} />
            ))}
            {interactive && (
              <>
                <i className="pe-rot-line" style={{ top: -26 / zoom, height: 26 / zoom, width: bw, background: accent }} />
                <b className="pe-handle pe-rot" role="presentation" title="Girar"
                  style={{ left: '50%', top: -26 / zoom, width: hs * 1.15, height: hs * 1.15, marginLeft: -hs * 0.575, marginTop: -hs * 0.575, borderWidth: bw, borderColor: accent, cursor: 'grab', pointerEvents: 'auto' }}
                  onPointerDown={(e) => begin('rotate', selected, e)} />
              </>
            )}
            {readout && <span className="pe-readout" style={{ fontSize: 12 / zoom, padding: `${3 / zoom}px ${7 / zoom}px`, top: `calc(100% + ${8 / zoom}px)`, transform: sbox.r ? `rotate(${-sbox.r}deg)` : undefined }}>{readout}</span>}
          </div>
        )}
      </PortfolioCanvas>
    </div>
  );
}
