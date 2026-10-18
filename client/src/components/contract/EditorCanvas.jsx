import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ElementContent } from './ElementView.jsx';
import EIcon from './EIcon.jsx';
import { MARGIN, boxStyle, hasFixedHeight, isInlineEditable, isoToday, pageSize, round1, textStyle } from '../../lib/contract/model.js';

const Content = memo(ElementContent);

const HANDLES = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const SNAP_PX = 6;
let gestureSeq = 0;

// Alças que cada tipo de elemento usa: textos têm altura automática (só largura).
function handlesFor(el) {
  if (el.locked) return [];
  if (hasFixedHeight(el.t) && el.t !== 'line') return Object.keys(HANDLES);
  return ['e', 'w'];
}

function snapAxis(start, size, targets, threshold) {
  let best = null;
  for (const t of targets) {
    for (const off of [0, size / 2, size]) {
      const d = t - (start + off);
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: t };
    }
  }
  return best;
}

// Caixa de texto de edição: usa o MESMO estilo do texto para não "pular" ao entrar e sair da edição.
function EditArea({ el, onChange, onDone }) {
  const ref = useRef(null);
  const extra = (el.borderWidth || 0) * 2;
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight + extra}px`;
  }, [el.text, el.w, el.fontSize, el.fontFamily, el.lineHeight, el.bold, el.italic, el.padding, el.letterSpacing, el.borderWidth, extra]);
  useEffect(() => {
    const t = ref.current;
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      className="ce-edit"
      lang="pt-BR"
      value={el.text}
      rows={1}
      aria-label="Editar texto"
      style={{ ...textStyle(el), height: 'auto', resize: 'none', overflow: 'hidden', outline: 'none' }}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onDone(); } }}
      onBlur={onDone}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

function Page({ page, index, count, orientation, zoom, today, ctx, selectedId, editingId, active, on }) {
  const { w: PW, h: PH } = pageSize(orientation);
  const pageRef = useRef(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [box, setBox] = useState(null); // tamanho real do elemento selecionado (textos têm altura automática)
  const [guides, setGuides] = useState(null);
  const sel = page.els.find((e) => e.id === selectedId) || null;

  useLayoutEffect(() => {
    const node = sel && pageRef.current?.querySelector(`[data-el="${sel.id}"]`);
    if (!node) { setBox(null); return undefined; }
    const read = () => setBox((b) => (b && b.w === node.offsetWidth && b.h === node.offsetHeight ? b : { w: node.offsetWidth, h: node.offsetHeight }));
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(node);
    return () => ro.disconnect();
  }, [sel?.id, editingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sizeOf = (id) => {
    const n = pageRef.current?.querySelector(`[data-el="${id}"]`);
    return { w: n?.offsetWidth || 0, h: n?.offsetHeight || 0 };
  };

  function track(onMove, onEnd) {
    const move = (ev) => onMove(ev);
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      onEnd();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function onElementDown(e, el) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (editingId === el.id) return;
    e.stopPropagation();
    const wasSelected = selectedId === el.id;
    on.select(page.id, el.id);
    if (editingId) on.stopEdit();
    if (el.locked) return;

    const start = { cx: e.clientX, cy: e.clientY, x: el.x, y: el.y };
    const me = sizeOf(el.id);
    const xs = [0, PW / 2, PW, MARGIN, PW - MARGIN];
    const ys = [0, PH / 2, PH, MARGIN, PH - MARGIN];
    for (const o of page.els) {
      if (o.id === el.id) continue;
      const s = sizeOf(o.id);
      xs.push(o.x, o.x + s.w / 2, o.x + s.w);
      ys.push(o.y, o.y + s.h / 2, o.y + s.h);
    }
    const gesture = `g:${++gestureSeq}`;
    let moved = false;
    track(
      (ev) => {
        const z = zoomRef.current;
        const dx = (ev.clientX - start.cx) / z;
        const dy = (ev.clientY - start.cy) / z;
        if (!moved && Math.hypot(dx, dy) * z < 3) return;
        moved = true;
        let nx = start.x + dx;
        let ny = start.y + dy;
        const g = { x: null, y: null };
        if (!ev.altKey) {
          const sx = snapAxis(nx, me.w, xs, SNAP_PX / z);
          const sy = snapAxis(ny, me.h, ys, SNAP_PX / z);
          if (sx) { nx += sx.d; g.x = sx.line; }
          if (sy) { ny += sy.d; g.y = sy.line; }
        }
        setGuides(g);
        on.patch(page.id, el.id, { x: round1(nx), y: round1(ny) }, gesture);
      },
      () => {
        setGuides(null);
        // Toque/clique num texto que já estava selecionado, sem arrastar: entra na edição.
        if (!moved && wasSelected && isInlineEditable(el.t)) on.startEdit(el.id);
      }
    );
  }

  function onHandleDown(e, el, dir) {
    e.stopPropagation();
    e.preventDefault();
    const fixedH = hasFixedHeight(el.t);
    const start = { cx: e.clientX, cy: e.clientY, x: el.x, y: el.y, w: el.w, h: fixedH ? el.h : sizeOf(el.id).h };
    const corner = dir.length === 2;
    const gesture = `g:${++gestureSeq}`;
    const minW = el.t === 'line' ? 8 : 16;
    const minH = 4;
    track(
      (ev) => {
        const z = zoomRef.current;
        const dx = (ev.clientX - start.cx) / z;
        const dy = (ev.clientY - start.cy) / z;
        let { x, y, w, h } = start;
        if (dir.includes('e')) w = start.w + dx;
        if (dir.includes('w')) { w = start.w - dx; }
        if (fixedH && dir.includes('s')) h = start.h + dy;
        if (fixedH && dir.includes('n')) { h = start.h - dy; }
        const horizontal = dir.includes('e') || dir.includes('w');
        const vertical = fixedH && (dir.includes('n') || dir.includes('s'));
        w = horizontal ? Math.max(minW, w) : start.w;
        h = vertical ? Math.max(minH, h) : start.h;
        // Imagens mantêm a proporção nos cantos (Shift mantém também nos retângulos).
        if (corner && fixedH && (el.t === 'image' || ev.shiftKey)) h = w / (start.w / start.h);
        if (dir.includes('w')) x = start.x + (start.w - w);
        if (fixedH && dir.includes('n')) y = start.y + (start.h - h);
        const patch = { x: round1(x), y: round1(y), w: round1(w) };
        if (fixedH) patch.h = round1(h);
        on.patch(page.id, el.id, patch, gesture);
      },
      () => {}
    );
  }

  const z = zoom;
  return (
    <section className={`ce-page-block ${active ? 'is-active' : ''}`} aria-label={`Página ${index + 1} de ${count}`}>
      <div className="ce-page-bar" style={{ width: PW * z }}>
        <strong>Página {index + 1} <span className="muted">de {count}</span></strong>
        <div className="ce-page-actions">
          <button type="button" className="ce-mini" onClick={() => on.pageAction('up', index)} disabled={index === 0} title="Mover página para cima" aria-label="Mover página para cima"><EIcon name="up" size={16} /></button>
          <button type="button" className="ce-mini" onClick={() => on.pageAction('down', index)} disabled={index === count - 1} title="Mover página para baixo" aria-label="Mover página para baixo"><EIcon name="down" size={16} /></button>
          <button type="button" className="ce-mini" onClick={() => on.pageAction('dup', index)} title="Duplicar página" aria-label="Duplicar página"><EIcon name="copy" size={16} /></button>
          <button type="button" className="ce-mini ce-mini-danger" onClick={() => on.pageAction('del', index)} disabled={count === 1} title="Excluir página" aria-label="Excluir página"><EIcon name="trash" size={16} /></button>
        </div>
      </div>

      <div className="ce-page-wrap" style={{ width: PW * z, height: PH * z }}>
        <div
          ref={pageRef}
          className="ce-page"
          style={{ width: PW, height: PH, background: page.bg, transform: `scale(${z})`, '--z': z }}
          onPointerDown={(e) => { if (e.target === e.currentTarget || e.target.classList.contains('ce-clip')) { on.select(page.id, null); on.stopEdit(); } }}
        >
          <div className="ce-clip">
            {page.els.map((el) => {
              const selected = el.id === selectedId;
              const editing = el.id === editingId;
              return (
                <div
                  key={el.id}
                  data-el={el.id}
                  className={`ce-el ${selected ? 'is-sel' : ''} ${el.locked ? 'is-locked' : ''}`}
                  style={boxStyle(el)}
                  onPointerDown={(e) => onElementDown(e, el)}
                  onDoubleClick={() => { if (isInlineEditable(el.t) && !el.locked) { on.select(page.id, el.id); on.startEdit(el.id); } }}
                >
                  {editing ? (
                    <EditArea el={el} onChange={(text) => on.patch(page.id, el.id, { text }, `txt:${el.id}`)} onDone={on.stopEdit} />
                  ) : (
                    <Content el={el} today={today} ctx={ctx} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Camada de seleção fora do recorte da página (as alças aparecem mesmo na borda). */}
          <div className="ce-overlay">
            {guides?.x != null && <i className="ce-guide ce-guide-v" style={{ left: guides.x }} />}
            {guides?.y != null && <i className="ce-guide ce-guide-h" style={{ top: guides.y }} />}
            {sel && box && (
              <div className={`ce-sel ${sel.locked ? 'is-locked' : ''}`} style={{ left: sel.x, top: sel.y, width: box.w, height: box.h }}>
                {sel.locked && <span className="ce-lock"><EIcon name="lock" size={12} /></span>}
                {handlesFor(sel).map((dir) => (
                  <i
                    key={dir}
                    className={`ce-handle ce-h-${dir}`}
                    style={{ left: `${HANDLES[dir][0] * 100}%`, top: `${HANDLES[dir][1] * 100}%` }}
                    onPointerDown={(e) => onHandleDown(e, sel, dir)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function EditorCanvas({ doc, zoom, ctx, selectedId, editingId, activePageId, on }) {
  const today = isoToday();
  return (
    <div className="ce-pages">
      {doc.pages.map((page, i) => (
        <Page
          key={page.id}
          page={page}
          index={i}
          count={doc.pages.length}
          orientation={doc.orientation}
          zoom={zoom}
          today={today}
          ctx={ctx}
          selectedId={selectedId}
          editingId={editingId}
          active={page.id === activePageId}
          on={on}
        />
      ))}
      <button type="button" className="btn btn-ghost ce-add-page" onClick={() => on.pageAction('add', doc.pages.length - 1)}>
        <EIcon name="plus" size={18} /> Adicionar página
      </button>
    </div>
  );
}
