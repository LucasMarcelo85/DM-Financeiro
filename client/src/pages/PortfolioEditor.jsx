import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import Modal from '../components/Modal.jsx';
import EIcon from '../components/contract/EIcon.jsx';
import PortfolioCanvas, { ClipDefs, PageBackground, PageCredit, pvVars } from '../components/portfolio/Canvas.jsx';
import Stage from '../components/portfolio/Stage.jsx';
import { ElementInspector, PageInspector } from '../components/portfolio/Inspector.jsx';
import ImageEditor from '../components/portfolio/ImageEditor.jsx';
import ShareModal from '../components/portfolio/ShareModal.jsx';
import CatalogSettings from '../components/CatalogSettings.jsx';
import {
  DESIGN_W, DEVICES, ELEMENT_LABELS, MAX_ELEMENTS, addElement, alignElement, boxOf, duplicateElement, findElement, moveLayer, newElement, normalizeDoc, pageHeight,
  layoutBoxes, patchBox, patchCatalog, patchElement, patchPixel, patchSeo, patchTheme, removeElement, scaleBox, markManual, syncDevices,
} from '../lib/portfolio/doc.js';
import { pageUrl } from '../lib/portfolio/model.js';
import { copyText } from '../lib/portfolio/share.js';
import { IMAGE_ACCEPT, fitImage } from '../lib/contract/image.js';
import { loadImage } from '../lib/portfolio/imageTools.js';

const PALETTE = [
  { t: 'text', icon: 'text' }, { t: 'image', icon: 'image' }, { t: 'icon', icon: 'logo' }, { t: 'button', icon: 'button' },
  { t: 'shape', icon: 'shape' }, { t: 'spacer', icon: 'align-middle' }, { t: 'video', icon: 'video' }, { t: 'carousel', icon: 'layers' }, { t: 'menu', icon: 'list' }, { t: 'products', icon: 'grid' }, { t: 'modal', icon: 'layers' }, { t: 'custom', icon: 'braces' },
  { t: 'footer', icon: 'file', label: 'Rodapé', quick: true },
  { t: 'catsearch', icon: 'text', catalog: true }, { t: 'catgrid', icon: 'grid', catalog: true },
];
const DEVICE_ICON = { desktop: 'desktop', tablet: 'tablet', mobile: 'mobile' };
const SAVE_LABEL = { saved: 'Salvo', dirty: 'Alterações não salvas', saving: 'Salvando...', error: 'Erro ao salvar' };
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5];

export default function PortfolioEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();

  const [doc, setDocState] = useState(null);
  const [meta, setMeta] = useState(null);
  const [name, setName] = useState('');
  const [saveState, setSaveState] = useState('saved');
  const [selectedId, setSelectedId] = useState(null);
  const [device, setDevice] = useState('desktop');
  const [manualZoom, setManualZoom] = useState(null);
  const [avail, setAvail] = useState(900);
  const [preview, setPreview] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [replay, setReplay] = useState(0);
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState('');
  const [leave, setLeave] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [leftTab, setLeftTab] = useState('add'); // 'add' | 'layers'
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [pages, setPages] = useState([]);
  const [imageTool, setImageTool] = useState(null); // { id, tool }
  const [catalogCfg, setCatalogCfg] = useState(false);
  const [converted, setConverted] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [panelW, setPanelW] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('pe-panels') || '{}'); return { l: Number(s.l) || 152, r: Number(s.r) || 320 }; } catch { return { l: 152, r: 320 }; }
  });
  useEffect(() => { try { localStorage.setItem('pe-panels', JSON.stringify(panelW)); } catch { /* sem armazenamento */ } }, [panelW]);

  function startResize(side, e) {
    e.preventDefault();
    const startX = e.clientX;
    const start = panelW[side];
    const move = (ev) => {
      const dx = ev.clientX - startX;
      const next = side === 'l' ? start + dx : start - dx;
      setPanelW((w) => ({ ...w, [side]: Math.round(Math.min(side === 'l' ? 360 : 640, Math.max(side === 'l' ? 96 : 240, next))) }));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('is-resizing'); };
    document.body.classList.add('is-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const docRef = useRef(null);
  const nameRef = useRef('');
  const past = useRef([]);
  const future = useRef([]);
  const lastKey = useRef({ key: null, t: 0 });
  const version = useRef(0);
  const savedVersion = useRef(0);
  const saving = useRef(false);
  const selectedRef = useRef(null);
  const deviceRef = useRef('desktop');
  const stageRef = useRef(null);
  const fileRef = useRef(null);
  const pendingAdd = useRef(null);
  selectedRef.current = selectedId;
  deviceRef.current = device;
  nameRef.current = name;

  // ---------------------------------------------------------------- carregar
  useEffect(() => {
    let alive = true;
    api.get(`/portfolios/${id}`)
      .then(({ portfolio: p }) => {
        if (!alive) return;
        const d = normalizeDoc(p.data, p.kind);
        docRef.current = d;
        setDocState(d);
        setConverted(p.data?.v !== 2 && Array.isArray(p.data?.blocks) && p.data.blocks.length > 0);
        setName(p.name);
        setMeta({ slug: p.slug, published: p.published, isMain: p.isMain, path: p.path, customUrl: p.customUrl, kind: p.kind });
        if (p.data?.v !== 2 && Array.isArray(p.data?.blocks) && p.data.blocks.length) { version.current = 1; setSaveState('dirty'); }
      })
      .catch((e) => { toast(e.message, 'error'); nav('/portfolio', { replace: true }); });
    api.get('/products').then((r) => { if (alive) { setProducts(r.products); setCategories(r.categories); } }).catch(() => {});
    api.get('/portfolios').then((r) => { if (alive) setPages(r.portfolios); }).catch((e) => { if (alive) toast(e.message, 'error'); });
    return () => { alive = false; };
  }, [id, nav, toast]);

  // largura disponível para o palco (zoom automático)
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, [doc && meta]); // eslint-disable-line react-hooks/exhaustive-deps

  const fitZoom = Math.min(1, Math.max(0.2, (avail - 40) / DESIGN_W[device]));
  const zoom = manualZoom ?? fitZoom;

  // ---------------------------------------------------------------- histórico
  const touch = useCallback(() => { version.current += 1; setSaveState('dirty'); }, []);

  // `key` agrupa alterações seguidas (digitar, arrastar, mexer numa barra) em um único passo de "desfazer".
  const commit = useCallback((next, key) => {
    const prev = docRef.current;
    if (!next || next === prev) return;
    const now = Date.now();
    if (!(key && lastKey.current.key === key && now - lastKey.current.t < 1200)) {
      past.current.push(prev);
      if (past.current.length > 100) past.current.shift();
    }
    lastKey.current = { key, t: now };
    future.current = [];
    docRef.current = next;
    setDocState(next);
    touch();
  }, [touch]);

  const jump = useCallback((from, to) => {
    if (!from.current.length) return;
    to.current.push(docRef.current);
    const d = from.current.pop();
    docRef.current = d;
    lastKey.current = { key: null, t: 0 };
    setDocState(d);
    setSelectedId((s) => (s && findElement(d, s) ? s : null));
    touch();
  }, [touch]);
  const undo = useCallback(() => jump(past, future), [jump]);
  const redo = useCallback(() => jump(future, past), [jump]);

  const selected = useMemo(() => (doc && selectedId ? findElement(doc, selectedId) : null), [doc, selectedId]);

  // ---------------------------------------------------------------- salvar
  const save = useCallback(async () => {
    if (saving.current || !docRef.current) return savedVersion.current === version.current;
    const v = version.current;
    if (v === savedVersion.current) { setSaveState('saved'); return true; }
    saving.current = true;
    setSaveState('saving');
    try {
      await api.patch(`/portfolios/${id}`, { name: nameRef.current, data: docRef.current });
      savedVersion.current = v;
      saving.current = false;
      setSaveState(version.current === v ? 'saved' : 'dirty');
      setConverted(false);
      return true;
    } catch (e) {
      saving.current = false;
      setSaveState('error');
      toast(e.message, 'error');
      return false;
    }
  }, [id, toast]);

  useEffect(() => {
    if (saveState !== 'dirty' || interacting) return undefined;
    const t = setTimeout(save, 2500);
    return () => clearTimeout(t);
  }, [saveState, doc, name, save, interacting]);

  useEffect(() => {
    const warn = (e) => { if (version.current !== savedVersion.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  async function goBack() {
    if (version.current === savedVersion.current) return nav('/portfolio');
    if (await save()) nav('/portfolio'); else setLeave(true);
    return undefined;
  }

  async function switchPage(nextId) {
    if (!nextId || nextId === id) return;
    if (version.current !== savedVersion.current && !(await save())) {
      setLeave(true);
      return;
    }
    nav(`/portfolio/${nextId}`);
  }

  // ---------------------------------------------------------------- publicar e compartilhar
  async function setPublished(value) {
    if (busy) return;
    setBusy('publish');
    try {
      if (!(await save())) return;
      const { portfolio } = await api.patch(`/portfolios/${id}`, { published: value });
      setMeta((m) => ({ ...m, published: portfolio.published }));
      toast(value ? 'Página publicada. O link já funciona.' : 'Página despublicada: agora só você vê.');
      if (value) setShare(true);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  }

  async function saveSlug(slug) {
    try {
      const { portfolio } = await api.patch(`/portfolios/${id}`, { slug });
      setMeta((m) => ({ ...m, slug: portfolio.slug, path: portfolio.path, customUrl: portfolio.customUrl }));
      toast('Endereço atualizado.');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function copyLink() {
    if (await copyText(pageUrl(meta.path, meta.customUrl))) toast('Link copiado!'); else setShare(true);
  }

  // ---------------------------------------------------------------- elementos
  // Coloca o elemento no dispositivo atual e deriva os outros dois a partir dele (cada um passa a ter vida própria).
  function place(el, x, y) {
    const dv = deviceRef.current;
    const W = DESIGN_W[dv];
    let b = { ...el.box[dv] };
    if (el.t === 'text' || el.t === 'button' || el.t === 'icon') b = { ...el.box.desktop, ...(dv !== 'desktop' ? el.box[dv] : {}) };
    if (b.w > W - 40 && el.t !== 'spacer') { b.h = Math.round(b.h * ((W - 40) / b.w)); b.w = W - 40; }
    b.x = el.t === 'spacer' ? 0 : Math.max(0, Math.round(x ?? (W - b.w) / 2));
    if (el.t === 'spacer') b.w = W;
    b.y = Math.max(0, Math.round(y ?? 60));
    const next = { ...el, box: { ...el.box, [dv]: b } };
    for (const d of DEVICES.map((v) => v.id)) if (d !== dv) next.box[d] = { ...next.box[d], ...scaleBox(b, dv, d, el.t), hide: false };
    return next;
  }

  function topOfView() {
    const sc = stageRef.current;
    const z = manualZoom ?? Math.min(1, Math.max(0.2, ((sc?.clientWidth || 900) - 40) / DESIGN_W[deviceRef.current]));
    return Math.max(40, Math.round(((sc?.scrollTop || 0) + 24) / z + 40));
  }

  function addNew(t, over = {}, at) {
    const d = docRef.current;
    if (d.elements.length >= MAX_ELEMENTS) { toast(`A página aceita até ${MAX_ELEMENTS} elementos.`, 'error'); return null; }
    let el = newElement(t, d.theme, over);
    el = place(el, at?.x, at?.y ?? topOfView());
    const withEl = addElement(d, el);
    commit(el.t === 'spacer' ? moveLayer(withEl, el.id, 'back') : withEl);
    setSelectedId(el.id);
    setPreview(false);
    setPanelOpen(true);
    return el;
  }

  function addFooter() {
    const d = docRef.current;
    if (d.elements.length + 3 > MAX_ELEMENTS) { toast(`A página aceita até ${MAX_ELEMENTS} elementos.`, 'error'); return; }
    const boxes = Object.fromEntries(DEVICES.map(({ id, w }) => {
      const y = pageHeight(d, id, products, d.catalog) + 24;
      return [id, { x: 0, y, w, h: 144, r: 0, hide: false }];
    }));
    const bg = newElement('shape', d.theme, { name: 'Fundo do rodapé', shape: 'rect', full: true, fill: { type: 'solid', c1: '#0f2238', c2: '#0f2238', angle: 135, animate: 'none' }, box: boxes });
    const textBoxes = Object.fromEntries(DEVICES.map(({ id, w }) => [id, { x: 24, y: boxes[id].y + 28, w: w - 48, h: 30, fs: 15, r: 0, hide: false }]));
    const text = newElement('text', d.theme, { name: 'Texto do rodapé', text: `© ${nameRef.current} · Todos os direitos reservados`, color: '#ffffff', align: 'center', box: textBoxes });
    const buttonBoxes = Object.fromEntries(DEVICES.map(({ id, w }) => [id, { x: Math.round((w - 220) / 2), y: boxes[id].y + 76, w: 220, h: 48, fs: 15, r: 0, hide: false }]));
    const button = newElement('button', d.theme, { name: 'Contato do rodapé', label: 'Fale conosco', style: 'outline', color: '#ffffff', textColor: '#ffffff', radius: 999, link: { kind: 'whatsapp', url: '', phone: '', message: 'Olá! Gostaria de saber mais.' }, box: buttonBoxes });
    commit({ ...d, manual: { ...d.manual, tablet: true, mobile: true }, elements: [...d.elements, bg, text, button] });
    setSelectedId(text.id);
    setPreview(false);
    setPanelOpen(true);
  }

  async function imageFromFile(file, at) {
    try {
      const { src } = await fitImage(file, 1600);
      const img = await loadImage(src);
      const w = Math.min(420, DESIGN_W[deviceRef.current] - 40);
      const h = Math.round(w * (img.naturalHeight / img.naturalWidth));
      const el = addNew('image', { src, box: { desktop: { x: 60, y: 60, w, h } } }, at && { x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2) });
      return el;
    } catch (e) { toast(e.message, 'error'); return null; }
  }

  function addFromPalette(t) {
    if (t === 'footer') { addFooter(); return; }
    if (t === 'image') { pendingAdd.current = null; fileRef.current?.click(); return; }
    if (t === 'products' && !products.length) toast('Cadastre produtos na aba Produtos/Serviços para escolher aqui.', 'error');
    const base = t === 'text' ? { box: { desktop: { x: 60, y: 60, w: 420, h: 70, fs: 28 } } } : t === 'icon' ? {} : undefined;
    addNew(t, base);
  }

  const addProductsIndividually = useCallback((ids) => {
    for (const productId of ids) {
      const current = docRef.current;
      const bottom = pageHeight(current, deviceRef.current, products, current.catalog);
      if (!addNew('products', { ids: [productId] }, { x: 40, y: bottom + 24 })) break;
    }
  }, [products]);

  const patchSelected = useCallback((patch, key) => {
    const sel = selectedRef.current;
    if (sel) commit(patchElement(docRef.current, sel, patch), `${sel}:${key || Object.keys(patch).join(',')}`);
  }, [commit]);

  const setBox = useCallback((elId, patch, key) => {
    const current = docRef.current;
    const device = deviceRef.current;
    const element = findElement(current, elId);
    const effective = layoutBoxes(current, device, products, current.catalog).get(elId);
    const normalized = patch.y !== undefined && element && effective
      ? { ...patch, y: patch.y - (effective.y - element.box[device].y) }
      : patch;
    commit(markManual(patchBox(current, elId, device, normalized), device), `${elId}:${device}:${key || Object.keys(patch).join(',')}`);
  }, [commit, products]);

  function act(action) {
    const sel = selectedRef.current;
    const d = docRef.current;
    if (!sel) return;
    if (action === 'delete') { commit(removeElement(d, sel)); setSelectedId(null); }
    else if (action === 'duplicate') {
      if (d.elements.length >= MAX_ELEMENTS) { toast(`A página aceita até ${MAX_ELEMENTS} elementos.`, 'error'); return; }
      const r = duplicateElement(d, sel);
      if (r.element) { commit(r.doc); setSelectedId(r.element.id); }
    } else if (['front', 'back', 'up', 'down'].includes(action)) commit(moveLayer(d, sel, action));
    else if (action.startsWith('align:')) commit(alignElement(d, sel, deviceRef.current, action.slice(6)));
    else if (action === 'copy-from-desktop') {
      const el = findElement(d, sel);
      if (el) commit(markManual(patchBox(d, sel, deviceRef.current, scaleBox(boxOf(el, 'desktop'), 'desktop', deviceRef.current, el.t)), deviceRef.current));
    }
  }

  const inspectorApi = useMemo(() => ({
    patch: patchSelected,
    box: (p, key) => { const sel = selectedRef.current; if (sel) setBox(sel, p, key); },
    patchTheme: (p, key) => commit(patchTheme(docRef.current, p), key || 'theme'),
    patchSeo: (p, key) => commit(patchSeo(docRef.current, p), key || 'seo'),
    patchPixel: (p, key) => commit(patchPixel(docRef.current, p), key || 'pixel'),
    patchCatalog: (p, key) => commit(patchCatalog(docRef.current, p), key || 'catalog'),
    addProductsIndividually,
    act, toast, saveSlug, copyLink,
    error: (m) => toast(m, 'error'),
    imageTool: (tool) => { if (selectedRef.current) setImageTool({ id: selectedRef.current, tool }); },
    play: () => { setAnimate(true); setReplay((r) => r + 1); },
    openCatalogSettings: () => setCatalogCfg(true),
  }), [patchSelected, setBox, commit, toast, addProductsIndividually, meta?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- atalhos
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const sel = selectedRef.current;
      if (mod && key === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)(); }
      else if (mod && key === 'y') { e.preventDefault(); redo(); }
      else if (mod && key === 's') { e.preventDefault(); save(); }
      else if (mod && key === 'd' && sel) { e.preventDefault(); act('duplicate'); }
      else if (!mod && (key === 'delete' || key === 'backspace') && sel) { e.preventDefault(); act('delete'); }
      else if (key === 'escape') setSelectedId(null);
      else if (sel && key.startsWith('arrow')) {
        const el = findElement(docRef.current, sel);
        if (!el || el.locked) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const b = el.box[deviceRef.current];
        setBox(sel, { x: b.x + (key === 'arrowright' ? step : key === 'arrowleft' ? -step : 0), y: b.y + (key === 'arrowdown' ? step : key === 'arrowup' ? -step : 0) }, 'nudge');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!doc || !meta) return <div className="splash"><span className="lamp lamp-lg is-pending" /></div>;

  const W = DESIGN_W[device];
  const toolEl = imageTool ? findElement(doc, imageTool.id) : null;
  const zoomIdx = ZOOMS.reduce((best, z, i) => (Math.abs(z - zoom) < Math.abs(ZOOMS[best] - zoom) ? i : best), 0);

  return (
    <div className="ce pe pe2">
      <header className="ce-top">
        <button type="button" className="btn btn-ghost btn-sm" onClick={goBack}><EIcon name="back" size={16} /> Portfólio</button>
        <select className="input input-sm pe-page-select" value={id} aria-label="Selecionar página do portfólio" onChange={(e) => switchPage(e.target.value)}>
          {pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
        </select>
        <input className="input input-sm ce-name" value={name} maxLength={120} aria-label="Nome da página"
          onChange={(e) => { setName(e.target.value); touch(); }}
          onBlur={() => { if (!name.trim()) { setName('Página sem título'); touch(); } }} />
        <span className={`ce-status is-${saveState}`} role="status">{SAVE_LABEL[saveState]}</span>
        <span className={`pe-pub ${meta.published ? 'is-on' : ''}`}>{meta.published ? 'Publicada' : 'Rascunho'}</span>
        <a className="btn btn-ghost btn-sm pe-page-url" href={pageUrl(meta.path, meta.customUrl)} target="_blank" rel="noopener noreferrer" title={pageUrl(meta.path, meta.customUrl)}>Link</a>
        <span className="ce-grow" />
        <div className="seg seg-view pe-device-seg" style={{ '--n': 3 }} role="radiogroup" aria-label="Desenhar para qual tela">
          {DEVICES.map((d) => (
            <button key={d.id} role="radio" aria-checked={device === d.id} className={device === d.id ? 'is-on' : ''} onClick={() => { if (d.id !== 'desktop' && docRef.current.kind !== 'catalog') commit(syncDevices(docRef.current)); setDevice(d.id); setManualZoom(null); }} title={`Desenhar a versão para ${d.label.toLowerCase()} (${d.w}px)`}>
              <EIcon name={DEVICE_ICON[d.id]} size={16} /> <span className="ce-lbl">{d.label}</span>
            </button>
          ))}
        </div>
        <label className="pe-bgpick" title="Cor de fundo do site">
          <span className="ce-lbl">Fundo</span>
          <input type="color" value={doc.theme.bg} onChange={(e) => inspectorApi.patchTheme({ bg: e.target.value }, 'theme:bg')} aria-label="Cor de fundo do site" />
        </label>
        <span className="pe-zoom" role="group" aria-label="Zoom">
          <button type="button" className="ce-mini" onClick={() => setManualZoom(ZOOMS[Math.max(0, zoomIdx - 1)])} disabled={zoomIdx === 0} title="Diminuir" aria-label="Diminuir zoom"><EIcon name="zoom-out" size={16} /></button>
          <button type="button" className="pe-zoom-val" onClick={() => setManualZoom(null)} title="Ajustar à tela">{Math.round(zoom * 100)}%</button>
          <button type="button" className="ce-mini" onClick={() => setManualZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIdx + 1)])} disabled={zoomIdx === ZOOMS.length - 1} title="Aumentar" aria-label="Aumentar zoom"><EIcon name="zoom-in" size={16} /></button>
        </span>
        <button type="button" className="ce-mini" onClick={undo} disabled={!past.current.length} title="Desfazer (Ctrl+Z)" aria-label="Desfazer"><EIcon name="undo" /></button>
        <button type="button" className="ce-mini" onClick={redo} disabled={!future.current.length} title="Refazer (Ctrl+Y)" aria-label="Refazer"><EIcon name="redo" /></button>
        <button type="button" className={`btn btn-ghost btn-sm ${animate ? 'is-on' : ''}`} aria-pressed={animate} onClick={() => { setAnimate((a) => !a); setReplay((r) => r + 1); }} title="Ver as animações rodando">
          <EIcon name="play" size={15} /> <span className="ce-lbl">{animate ? 'Parar animações' : 'Testar animações'}</span>
        </button>
        <button type="button" className={`btn btn-ghost btn-sm ${preview ? 'is-on' : ''}`} aria-pressed={preview} onClick={() => { setPreview((p) => !p); setSelectedId(null); setAnimate(false); }} title="Ver a página sem as ferramentas de edição">
          <EIcon name="eye" size={15} /> <span className="ce-lbl">{preview ? 'Voltar a editar' : 'Visualizar'}</span>
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPublished(!meta.published)} disabled={!!busy}>{busy === 'publish' ? 'Aguarde...' : meta.published ? 'Despublicar' : 'Publicar'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShare(true)}><EIcon name="share" size={16} /> <span className="ce-lbl">Compartilhar</span></button>
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saveState === 'saving' || saveState === 'saved'}>Salvar</button>
      </header>

      {converted && <p className="banner banner-amber pe-converted" role="status">Esta página foi criada no editor antigo e foi convertida para o editor livre. Confira como ficou em cada tela (computador, tablet e celular) e ajuste. Ela só é salva quando você salvar ou editar.</p>}

      <div className="ce-body" style={{ '--pe-l': `${panelW.l}px`, '--pe-r': `${panelW.r}px` }}>
        <div className="pe-resizer is-left" role="separator" aria-orientation="vertical" aria-label="Arrastar para alterar a largura das ferramentas" title="Arraste para ajustar" onPointerDown={(e) => startResize('l', e)} />
        <div className="pe-resizer is-right" role="separator" aria-orientation="vertical" aria-label="Arrastar para alterar a largura das propriedades" title="Arraste para ajustar" onPointerDown={(e) => startResize('r', e)} />
        <nav className="ce-palette pe-left" aria-label="Elementos">
          <div className="pe-left-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={leftTab === 'add'} className={leftTab === 'add' ? 'is-on' : ''} onClick={() => setLeftTab('add')}>Adicionar</button>
            <button type="button" role="tab" aria-selected={leftTab === 'layers'} className={leftTab === 'layers' ? 'is-on' : ''} onClick={() => setLeftTab('layers')}>Camadas</button>
          </div>
          {leftTab === 'add' ? PALETTE.filter((p) => !p.catalog || meta.kind === 'catalog').map((p) => (
            <button key={p.t} type="button" className="ce-tool" draggable={!p.quick} onClick={() => addFromPalette(p.t)} onDragStart={(e) => { if (!p.quick) { e.dataTransfer.setData('text/pv-type', p.t); e.dataTransfer.effectAllowed = 'copy'; } }}
              title={p.quick ? 'Adicionar uma seção de rodapé pronta' : `Adicionar ${ELEMENT_LABELS[p.t].toLowerCase()} (clique ou arraste para a página)`}>
              <EIcon name={p.icon} size={20} />
              <span>{p.label || ELEMENT_LABELS[p.t]}</span>
            </button>
          )) : (
            <ul className="pe-layers">
              {[...doc.elements].reverse().map((el) => {
                const b = el.box[device];
                return (
                  <li key={el.id} className={`${selectedId === el.id ? 'is-on' : ''}${b.hide ? ' is-off' : ''}`}>
                    <button type="button" className="pe-layer-name" onClick={() => { setSelectedId(el.id); setPanelOpen(true); }}>
                      {el.name || (el.t === 'text' ? (el.text || '').slice(0, 22) || 'Texto' : el.t === 'button' ? el.label : ELEMENT_LABELS[el.t])}
                      <small>{ELEMENT_LABELS[el.t]}</small>
                    </button>
                    <button type="button" className="ce-mini" onClick={() => commit(patchBox(docRef.current, el.id, device, { hide: !b.hide }))} title={b.hide ? 'Mostrar neste dispositivo' : 'Esconder neste dispositivo'} aria-label="Mostrar ou esconder"><EIcon name={b.hide ? 'eye-off' : 'eye'} size={14} /></button>
                    <button type="button" className="ce-mini" onClick={() => commit(patchElement(docRef.current, el.id, { locked: !el.locked }))} title={el.locked ? 'Destravar' : 'Travar'} aria-label="Travar ou destravar"><EIcon name={el.locked ? 'lock' : 'unlock'} size={14} /></button>
                  </li>
                );
              })}
              {!doc.elements.length && <li className="muted small pe-layers-empty">Nenhum elemento ainda.</li>}
            </ul>
          )}
        </nav>

        <main className="ce-stage pe-stage2" ref={stageRef}>
          <div className="pe-frame" style={{ width: W * zoom, ...pvVars(doc.theme) }}>
            <PageBackground theme={doc.theme} />
            {preview ? (
              <>
                <ClipDefs />
                <PortfolioCanvas doc={doc} device={device} scale={zoom} mode="public" animate products={products} replay={replay} viewportFixed={false} />
              </>
            ) : (
              <Stage doc={doc} device={device} zoom={zoom} selectedId={selectedId} products={products} animate={animate} replay={replay}
                onSelect={(sid) => { setSelectedId(sid); if (sid) setPanelOpen(true); }}
                onBox={setBox} onInteract={setInteracting}
                onDropType={(t, x, y) => addNew(t, undefined, { x: Math.round(x - 100), y: Math.round(y - 30) })}
                onDropFile={(f, x, y) => imageFromFile(f, { x, y })}
                onEdit={(eid) => {
                  const el = findElement(docRef.current, eid);
                  if (!el) return;
                  setPanelOpen(true);
                  if (el.t === 'text') setTimeout(() => document.getElementById('text-content')?.focus(), 60);
                  else if (el.t === 'image') { if (el.src) setImageTool({ id: eid, tool: 'crop' }); else fileRef.current?.click(); }
                }} />
            )}
            <PageCredit theme={doc.theme} />
          </div>
          {!doc.elements.length && !preview && <p className="pe-empty-hint">Comece adicionando elementos pela barra à esquerda: clique ou arraste para a página. Também dá para soltar uma imagem do seu computador aqui.</p>}
        </main>

        <aside className={`ce-side ${panelOpen ? 'is-open' : ''}`} aria-label="Propriedades">
          <button type="button" className="ce-side-toggle" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
            {panelOpen ? 'Fechar propriedades' : selected ? `Propriedades: ${ELEMENT_LABELS[selected.t]}` : 'Propriedades da página'}
          </button>
          {selected
            ? <ElementInspector el={selected} device={device} api={inspectorApi} products={products} layoutBox={layoutBoxes(doc, device, products, doc.catalog).get(selected.id)} />
            : <PageInspector doc={doc} device={device} meta={meta} api={inspectorApi} categories={categories} products={products} />}
        </aside>
      </div>

      <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} hidden onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (!f) return;
        const sel = selectedRef.current && findElement(docRef.current, selectedRef.current);
        if (sel?.t === 'image' && !sel.src) { try { patchSelected({ src: (await fitImage(f, 1600)).src }, 'src'); } catch (er) { toast(er.message, 'error'); } } else imageFromFile(f);
      }} />

      {toolEl && toolEl.src && (
        <ImageEditor src={toolEl.src} initial={imageTool.tool} onClose={() => setImageTool(null)}
          onApply={(src) => { commit(patchElement(docRef.current, toolEl.id, { src, zoom: 1, px: 50, py: 50 })); toast('Imagem atualizada.'); }} />
      )}
      {catalogCfg && <CatalogSettings onClose={() => setCatalogCfg(false)} />}
      {share && <ShareModal name={name} path={meta.path} published={meta.published} busy={busy === 'publish'} onPublish={() => setPublished(true)} onClose={() => setShare(false)} />}
      {leave && (
        <Modal title="Não foi possível salvar" onClose={() => setLeave(false)}
          footer={<><button className="btn btn-ghost" onClick={() => setLeave(false)}>Continuar editando</button><button className="btn btn-danger" onClick={() => { version.current = savedVersion.current; nav('/portfolio'); }}>Sair sem salvar</button></>}>
          <p>Suas últimas alterações ainda não foram salvas. Se sair agora, elas serão perdidas.</p>
        </Modal>
      )}
    </div>
  );
}
