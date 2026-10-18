import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import Modal from '../components/Modal.jsx';
import EditorCanvas from '../components/contract/EditorCanvas.jsx';
import Inspector from '../components/contract/Inspector.jsx';
import EIcon from '../components/contract/EIcon.jsx';
import ClientPicker from '../components/contract/ClientPicker.jsx';
import VariablePicker from '../components/contract/VariablePicker.jsx';
import {
  MARGIN, MAX_ELEMENTS, MAX_PAGES, addElement, addPage, clamp, cloneElement, duplicatePage, exportPayload, findElement, hasFixedHeight,
  mapPage, movePage, newElement, normalizeDoc, pageSize, patchElement, removeElement, removePage, reorderElement, round1,
} from '../lib/contract/model.js';
import { fitImage, IMAGE_ACCEPT } from '../lib/contract/image.js';
import { IMPORT_ACCEPT, importFile } from '../lib/contract/import.js';
import { footerBlock, headerBlock, signaturesBlock } from '../lib/contract/templates.js';
import { buildContext, missingVariables, variableLabel } from '../lib/contract/variables.js';
import { downloadJson, printContract } from '../lib/contract/print.jsx';

const PALETTE = [
  { id: 'title', label: 'Título', icon: 'title' },
  { id: 'subtitle', label: 'Subtítulo', icon: 'subtitle' },
  { id: 'text', label: 'Texto', icon: 'text' },
  { id: 'date', label: 'Data', icon: 'date' },
  { id: 'variavel', label: 'Variável', icon: 'braces' },
  { id: 'capsule', label: 'Cápsula', icon: 'capsule' },
  { id: 'logo', label: 'Logo', icon: 'logo' },
  { id: 'image', label: 'Imagem', icon: 'image' },
  { id: 'line', label: 'Linha', icon: 'line' },
  { id: 'shape', label: 'Retângulo', icon: 'shape' },
];
const SAVE_LABEL = { saved: 'Salvo', dirty: 'Alterações não salvas', saving: 'Salvando...', error: 'Erro ao salvar' };

export default function ContractEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [qs, setQs] = useSearchParams();

  const [doc, setDocState] = useState(null);
  const [name, setName] = useState('');
  const [saveState, setSaveState] = useState('saved');
  const [selectedId, setSelectedId] = useState(null);
  const [activePageId, setActivePageId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [autoZoom, setAutoZoom] = useState(true);
  const [busy, setBusy] = useState('');
  const [leave, setLeave] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [contact, setContact] = useState(null); // cliente escolhido: as variáveis mostram os dados dele
  const [picker, setPicker] = useState(false);
  const [varsOpen, setVarsOpen] = useState(false);

  const docRef = useRef(null);
  const nameRef = useRef('');
  const past = useRef([]);
  const future = useRef([]);
  const lastKey = useRef({ key: null, t: 0 });
  const version = useRef(0); // sobe a cada alteração
  const savedVersion = useRef(0);
  const saving = useRef(false);
  const clip = useRef(null);
  const stageRef = useRef(null);
  const imgInput = useRef(null);
  const imgMode = useRef('image');
  const importInput = useRef(null);
  nameRef.current = name;

  // ---------------------------------------------------------------- carregar
  useEffect(() => {
    let alive = true;
    api.get(`/contracts/${id}`)
      .then(({ contract }) => {
        if (!alive) return;
        const d = normalizeDoc(contract.data);
        docRef.current = d;
        setDocState(d);
        setName(contract.name);
        setActivePageId(d.pages[0].id);
      })
      .catch((e) => { toast(e.message, 'error'); nav('/contratos', { replace: true }); });
    return () => { alive = false; };
  }, [id, nav, toast]);

  // ---------------------------------------------------------------- histórico
  const touch = useCallback(() => {
    version.current += 1;
    setSaveState('dirty');
  }, []);

  // `key` agrupa alterações seguidas (arrastar, digitar, escolher cor) em um único passo de "desfazer".
  const commit = useCallback((next, key) => {
    const prev = docRef.current;
    if (!next || next === prev) return;
    const now = Date.now();
    const group = key && lastKey.current.key === key && (key.startsWith('g:') || now - lastKey.current.t < 1200);
    if (!group) {
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
    if (!d.pages.some((p) => p.id === activePageIdRef.current)) setActivePageId(d.pages[0].id);
    setSelectedId((s) => (s && findElement(d, s) ? s : null));
    setEditingId(null);
    touch();
  }, [touch]);
  const undo = useCallback(() => jump(past, future), [jump]);
  const redo = useCallback(() => jump(future, past), [jump]);

  const activePageIdRef = useRef(null);
  activePageIdRef.current = activePageId;
  const selectedRef = useRef(null);
  selectedRef.current = selectedId;

  const activePage = useMemo(() => doc?.pages.find((p) => p.id === activePageId) || doc?.pages[0], [doc, activePageId]);
  const activeIndex = doc ? Math.max(0, doc.pages.findIndex((p) => p.id === activePage?.id)) : 0;
  const selected = useMemo(() => (doc && selectedId ? findElement(doc, selectedId) : null), [doc, selectedId]);
  const ctx = useMemo(() => (contact ? buildContext({ contact, user }) : null), [contact, user]);
  const ctxRef = useRef(null);
  ctxRef.current = ctx;
  const missing = useMemo(() => (ctx && doc ? missingVariables(doc, ctx) : []), [ctx, doc]);

  // Abriu pela lista com "Gerar para cliente" (?cliente=ID): já escolhe o cliente.
  const clienteId = qs.get('cliente');
  useEffect(() => {
    if (!clienteId) return;
    api.get(`/contacts/${clienteId}`).then((r) => setContact(r.contact)).catch(() => toast('Cliente não encontrado.', 'error'));
  }, [clienteId, toast]);
  const chooseClient = (c) => { setContact(c); setPicker(false); if (qs.get('cliente')) setQs({}, { replace: true }); };
  const clearClient = () => { setContact(null); if (qs.get('cliente')) setQs({}, { replace: true }); };

  // ---------------------------------------------------------------- salvar
  const save = useCallback(async () => {
    if (saving.current || !docRef.current) return savedVersion.current === version.current;
    const v = version.current;
    if (v === savedVersion.current) { setSaveState('saved'); return true; }
    saving.current = true;
    setSaveState('saving');
    try {
      await api.patch(`/contracts/${id}`, { name: nameRef.current, data: docRef.current });
      savedVersion.current = v;
      saving.current = false;
      setSaveState(version.current === v ? 'saved' : 'dirty');
      return true;
    } catch (e) {
      saving.current = false;
      setSaveState('error');
      toast(e.message, 'error');
      return false;
    }
  }, [id, toast]);

  useEffect(() => {
    if (saveState !== 'dirty') return undefined;
    const t = setTimeout(save, 2500);
    return () => clearTimeout(t);
  }, [saveState, doc, name, save]);

  useEffect(() => {
    const warn = (e) => { if (version.current !== savedVersion.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  async function goBack() {
    if (version.current === savedVersion.current) return nav('/contratos');
    if (await save()) nav('/contratos'); else setLeave(true);
    return undefined;
  }

  // ---------------------------------------------------------------- zoom
  useEffect(() => {
    if (!doc || !autoZoom) return undefined;
    const fit = () => {
      const w = stageRef.current?.clientWidth;
      if (w) setZoom(clamp(round1((w - 40) / pageSize(doc.orientation).w), 0.3, 1));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [doc?.orientation, autoZoom, !!doc]); // eslint-disable-line react-hooks/exhaustive-deps
  const setZoomManual = (z) => { setAutoZoom(false); setZoom(clamp(Math.round(z * 100) / 100, 0.3, 2)); };

  // ---------------------------------------------------------------- inserir / editar
  const domHeight = (elId) => document.querySelector(`[data-el="${elId}"]`)?.offsetHeight || 0;

  function nextY(page, orientation) {
    const { h } = pageSize(orientation);
    const bottom = page.els.reduce((m, e) => Math.max(m, e.y + (hasFixedHeight(e.t) ? e.h : domHeight(e.id))), 0);
    const y = page.els.length ? bottom + 20 : MARGIN;
    return y > h - 120 ? MARGIN : y;
  }

  function insert(el, { select = true } = {}) {
    const d = docRef.current;
    const page = d.pages.find((p) => p.id === activePageIdRef.current) || d.pages[0];
    if (page.els.length >= MAX_ELEMENTS) { toast(`Cada página aceita até ${MAX_ELEMENTS} elementos.`, 'error'); return; }
    commit(addElement(d, page.id, el));
    if (select) { setActivePageId(page.id); setSelectedId(el.id); setEditingId(null); }
  }

  function addByType(type) {
    if (type === 'variavel') { setVarsOpen(true); return; }
    if (type === 'logo' || type === 'image') {
      imgMode.current = type;
      imgInput.current?.click();
      return;
    }
    const d = docRef.current;
    const page = d.pages.find((p) => p.id === activePageIdRef.current) || d.pages[0];
    const { w: PW } = pageSize(d.orientation);
    const el = newElement(type);
    el.w = Math.min(el.w, PW - MARGIN * 2);
    el.x = Math.round((PW - el.w) / 2);
    el.y = nextY(page, d.orientation);
    insert(el);
    if (type === 'title' || type === 'subtitle' || type === 'text' || type === 'capsule') setTimeout(() => setEditingId(el.id), 0);
  }

  async function onPickImage(file, mode, replaceId) {
    if (!file) return;
    try {
      const img = await fitImage(file);
      if (replaceId) {
        const f = findElement(docRef.current, replaceId);
        if (f) {
          const h = Math.round((f.el.w * img.h) / img.w);
          commit(patchElement(docRef.current, f.page.id, replaceId, { src: img.src, h }));
        }
        return;
      }
      const d = docRef.current;
      const page = d.pages.find((p) => p.id === activePageIdRef.current) || d.pages[0];
      const { w: PW } = pageSize(d.orientation);
      const w = Math.min(img.w, mode === 'logo' ? 150 : 360, PW - MARGIN * 2);
      const h = Math.round((w * img.h) / img.w);
      const x = mode === 'logo' ? MARGIN : Math.round((PW - w) / 2);
      const y = mode === 'logo' ? 40 : nextY(page, d.orientation);
      insert(newElement('image', { x, y, w, h, src: img.src, fit: 'contain' }));
    } catch (e) { toast(e.message, 'error'); }
  }

  function insertBlock(kind) {
    const d = docRef.current;
    const page = d.pages.find((p) => p.id === activePageIdRef.current) || d.pages[0];
    const { h: PH } = pageSize(d.orientation);
    const els = kind === 'header' ? headerBlock(d.orientation) : kind === 'footer' ? footerBlock(d.orientation) : signaturesBlock(d.orientation, clamp(nextY(page, d.orientation) + 40, MARGIN, PH - 150));
    if (page.els.length + els.length > MAX_ELEMENTS) { toast('A página já tem elementos demais.', 'error'); return; }
    // Cabeçalho vai para trás de tudo; os demais, na frente.
    commit(mapPage(d, page.id, (p) => ({ ...p, els: kind === 'header' ? [...els, ...p.els] : [...p.els, ...els] })));
    setSelectedId(null);
    toast(kind === 'header' ? 'Cabeçalho inserido. Edite os textos com um clique.' : kind === 'footer' ? 'Rodapé inserido.' : 'Assinaturas inseridas.');
  }

  const patchSelected = (patch, key) => {
    const f = selectedRef.current && findElement(docRef.current, selectedRef.current);
    if (f) commit(patchElement(docRef.current, f.page.id, f.el.id, patch), key || `p:${f.el.id}:${Object.keys(patch).join(',')}`);
  };

  function act(action) {
    const d = docRef.current;
    const f = selectedRef.current && findElement(d, selectedRef.current);
    if (!f) return;
    const { page, el } = f;
    if (action === 'delete') { commit(removeElement(d, page.id, el.id)); setSelectedId(null); setEditingId(null); }
    else if (action === 'duplicate') {
      if (page.els.length >= MAX_ELEMENTS) return toast(`Cada página aceita até ${MAX_ELEMENTS} elementos.`, 'error');
      const copy = cloneElement(el);
      commit(addElement(d, page.id, copy));
      setSelectedId(copy.id);
    } else if (action === 'lock') commit(patchElement(d, page.id, el.id, { locked: !el.locked }));
    else if (action === 'front' || action === 'back') commit(reorderElement(d, page.id, el.id, action));
    else if (action === 'replaceImage') { imgMode.current = `replace:${el.id}`; imgInput.current?.click(); }
    else if (action.startsWith('align:')) {
      const { w: PW, h: PH } = pageSize(d.orientation);
      const h = hasFixedHeight(el.t) ? el.h : domHeight(el.id);
      const how = action.slice(6);
      const patch = how === 'left' ? { x: 0 } : how === 'right' ? { x: PW - el.w } : how === 'center' ? { x: round1((PW - el.w) / 2) }
        : how === 'top' ? { y: 0 } : how === 'bottom' ? { y: PH - h } : { y: round1((PH - h) / 2) };
      commit(patchElement(d, page.id, el.id, patch));
    }
    return undefined;
  }

  // Insere {{variável}} no texto selecionado (na posição do cursor, se houver) ou numa nova caixa de texto.
  function insertVariable(key, caret) {
    const token = `{{${key}}}`;
    const d = docRef.current;
    const f = selectedRef.current && findElement(d, selectedRef.current);
    if (f && ['title', 'subtitle', 'text', 'capsule'].includes(f.el.t) && !f.el.locked) {
      const text = f.el.text || '';
      const at = Number.isInteger(caret) && caret >= 0 && caret <= text.length ? caret : text.length;
      const before = text.slice(0, at);
      const glue = at === text.length && before && !/[\s(\[]$/.test(before) ? ' ' : '';
      commit(patchElement(d, f.page.id, f.el.id, { text: `${before}${glue}${token}${text.slice(at)}` }), `var:${f.el.id}`);
      toast(`Inserido: ${variableLabel(key)}`);
      return;
    }
    const page = d.pages.find((p) => p.id === activePageIdRef.current) || d.pages[0];
    const { w: PW } = pageSize(d.orientation);
    const el = newElement('text', { text: token });
    el.w = Math.min(el.w, PW - MARGIN * 2);
    el.x = Math.round((PW - el.w) / 2);
    el.y = nextY(page, d.orientation);
    insert(el);
    toast(`Nova caixa criada com: ${variableLabel(key)}`);
  }

  function pageAction(action, index) {
    const d = docRef.current;
    if (action === 'add' || action === 'dup') {
      if (d.pages.length >= MAX_PAGES) return toast(`O contrato pode ter no máximo ${MAX_PAGES} páginas.`, 'error');
      const next = action === 'add' ? addPage(d, index) : duplicatePage(d, index);
      commit(next);
      setActivePageId(next.pages[index + 1].id);
      setSelectedId(null);
    } else if (action === 'up') commit(movePage(d, index, -1));
    else if (action === 'down') commit(movePage(d, index, 1));
    else if (action === 'del') {
      if (d.pages[index].els.length && !window.confirm('Excluir esta página e tudo o que está nela? (Dá para desfazer com Ctrl+Z)')) return undefined;
      const next = removePage(d, index);
      commit(next);
      setActivePageId(next.pages[Math.min(index, next.pages.length - 1)].id);
      setSelectedId(null);
    }
    return undefined;
  }

  const canvasApi = useMemo(() => ({
    select: (pageId, elId) => { setActivePageId(pageId); setSelectedId(elId); },
    startEdit: (elId) => setEditingId(elId),
    stopEdit: () => setEditingId(null),
    patch: (pageId, elId, patch, key) => commit(patchElement(docRef.current, pageId, elId, patch), key),
    pageAction,
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- atalhos
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)(); }
      else if (mod && key === 'y') { e.preventDefault(); redo(); }
      else if (mod && key === 's') { e.preventDefault(); save(); }
      else if (mod && key === 'd') { e.preventDefault(); act('duplicate'); }
      else if (mod && key === 'c') {
        const f = selectedRef.current && findElement(docRef.current, selectedRef.current);
        if (f) { clip.current = f.el; e.preventDefault(); }
      } else if (mod && key === 'v' && clip.current) {
        e.preventDefault();
        const copy = cloneElement(clip.current, 0, 0);
        clip.current = { ...clip.current, x: clip.current.x + 16, y: clip.current.y + 16 };
        insert(copy);
      } else if (!mod && (key === 'delete' || key === 'backspace') && selectedRef.current) { e.preventDefault(); act('delete'); }
      else if (!mod && key === 'enter' && selectedRef.current) {
        const f = findElement(docRef.current, selectedRef.current);
        if (f && ['title', 'subtitle', 'text', 'capsule'].includes(f.el.t) && !f.el.locked) { e.preventDefault(); setEditingId(f.el.id); }
      } else if (key === 'escape') { setSelectedId(null); setEditingId(null); }
      else if (!mod && key.startsWith('arrow') && selectedRef.current) {
        const f = findElement(docRef.current, selectedRef.current);
        if (!f || f.el.locked) return;
        e.preventDefault();
        const s = e.shiftKey ? 10 : 1;
        const d = { arrowleft: [-s, 0], arrowright: [s, 0], arrowup: [0, -s], arrowdown: [0, s] }[key];
        if (d) commit(patchElement(docRef.current, f.page.id, f.el.id, { x: f.el.x + d[0], y: f.el.y + d[1] }), `nudge:${f.el.id}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- importar / exportar / imprimir
  async function onImport(file) {
    if (!file) return;
    if (docRef.current.pages.some((p) => p.els.length) && !window.confirm('Importar vai substituir o conteúdo atual deste contrato. (Dá para desfazer com Ctrl+Z.) Continuar?')) return;
    setBusy('Importando...');
    try {
      const r = await importFile(file);
      commit(r.doc);
      setActivePageId(r.doc.pages[0].id);
      setSelectedId(null);
      toast(`Arquivo importado (${r.doc.pages.length} ${r.doc.pages.length === 1 ? 'página' : 'páginas'}). ${r.notes[0] || ''}`.trim());
    } catch (e) { toast(e.message || 'Não foi possível importar o arquivo.', 'error'); } finally { setBusy(''); }
  }

  async function print() {
    setSelectedId(null); setEditingId(null);
    setBusy('Preparando...');
    try { await printContract(docRef.current, contact ? `${nameRef.current} - ${contact.name}` : nameRef.current, ctxRef.current); } catch { toast('Não foi possível abrir a impressão.', 'error'); } finally { setBusy(''); }
  }

  const exportJson = () => downloadJson(`${(nameRef.current || 'contrato').replace(/[^\w\- ]+/g, '').trim() || 'contrato'}.json`, exportPayload(nameRef.current, docRef.current));

  if (!doc) return <div className="splash"><span className="lamp lamp-lg is-pending" /></div>;

  return (
    <div className="ce">
      <header className="ce-top">
        <button type="button" className="btn btn-ghost btn-sm" onClick={goBack}><EIcon name="back" size={16} /> Contratos</button>
        <input
          className="input input-sm ce-name"
          value={name}
          maxLength={120}
          aria-label="Nome do contrato"
          onChange={(e) => { setName(e.target.value); touch(); }}
          onBlur={() => { if (!name.trim()) { setName('Contrato sem título'); touch(); } }}
        />
        <span className={`ce-status is-${saveState}`} role="status">{SAVE_LABEL[saveState]}</span>
        <span className="ce-grow" />
        <span className={`ce-client ${contact ? 'is-on' : ''}`}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicker(true)} title="Ver o contrato com os dados de um cliente"><EIcon name="user" size={16} /> <span className="ce-client-name">{contact ? contact.name : 'Ver com cliente'}</span></button>
          {contact && <button type="button" className="ce-mini" onClick={clearClient} aria-label="Voltar a mostrar as variáveis" title="Voltar a mostrar as variáveis"><EIcon name="x" size={14} /></button>}
        </span>
        <button type="button" className="ce-mini" onClick={undo} disabled={!past.current.length} title="Desfazer (Ctrl+Z)" aria-label="Desfazer"><EIcon name="undo" /></button>
        <button type="button" className="ce-mini" onClick={redo} disabled={!future.current.length} title="Refazer (Ctrl+Y)" aria-label="Refazer"><EIcon name="redo" /></button>
        <span className="ce-zoom">
          <button type="button" className="ce-mini" onClick={() => setZoomManual(zoom - 0.1)} aria-label="Diminuir zoom"><EIcon name="minus" size={16} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" className="ce-mini" onClick={() => setZoomManual(zoom + 0.1)} aria-label="Aumentar zoom"><EIcon name="plus" size={16} /></button>
          <button type="button" className="ce-mini" onClick={() => setAutoZoom(true)} title="Ajustar à tela" aria-label="Ajustar à tela"><EIcon name="fit" size={16} /></button>
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => importInput.current?.click()} disabled={!!busy}><EIcon name="upload" size={16} /> <span className="ce-lbl">Importar</span></button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={exportJson}><EIcon name="download" size={16} /> <span className="ce-lbl">Exportar</span></button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={print} disabled={!!busy}><EIcon name="print" size={16} /> <span className="ce-lbl">PDF / Imprimir</span></button>
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saveState === 'saving' || saveState === 'saved'}>Salvar</button>
      </header>

      {contact && (
        <div className="ce-preview" role="status">
          <span>Mostrando os dados de <strong>{contact.name}</strong> nas variáveis. O PDF sai assim.</span>
          {missing.length > 0
            ? <span className="ce-preview-warn">Faltam no cadastro: {missing.map((m) => m.label).join(', ')}. Saem como ________ (complete em Clientes).</span>
            : <span className="ce-preview-ok">Todos os campos usados estão preenchidos.</span>}
        </div>
      )}

      <div className="ce-body">
        <nav className="ce-palette" aria-label="Inserir elementos">
          {PALETTE.map((p) => (
            <button key={p.id} type="button" className="ce-tool" onClick={() => addByType(p.id)} title={`Inserir ${p.label.toLowerCase()}`}>
              <EIcon name={p.icon} size={20} />
              <span>{p.label}</span>
            </button>
          ))}
        </nav>

        <main className="ce-stage" ref={stageRef}>
          <EditorCanvas doc={doc} zoom={zoom} ctx={ctx} selectedId={selectedId} editingId={editingId} activePageId={activePage?.id} on={canvasApi} />
        </main>

        <aside className={`ce-side ${panelOpen ? 'is-open' : ''}`} aria-label="Propriedades">
          <button type="button" className="ce-side-toggle" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
            {panelOpen ? 'Fechar propriedades' : selected ? 'Propriedades do elemento' : 'Propriedades da página'}
          </button>
          <Inspector
            el={selected?.el || null}
            doc={doc}
            activePageIndex={activeIndex}
            api={{
              patch: patchSelected,
              act,
              insertBlock,
              insertVariable,
              setOrientation: (o) => commit({ ...docRef.current, orientation: o }),
              setPageBg: (bg, key) => commit(mapPage(docRef.current, activePage.id, (p) => ({ ...p, bg })), key),
            }}
          />
        </aside>
      </div>

      <input ref={imgInput} type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => {
        const file = e.target.files?.[0];
        const mode = imgMode.current;
        e.target.value = '';
        onPickImage(file, mode.startsWith('replace:') ? 'image' : mode, mode.startsWith('replace:') ? mode.slice(8) : null);
      }} />
      <input ref={importInput} type="file" accept={IMPORT_ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onImport(f); }} />
      {picker && <ClientPicker title="Ver o contrato com os dados de..." onPick={chooseClient} onClose={() => setPicker(false)} />}
      {varsOpen && (
        <Modal title="Variáveis do contrato" onClose={() => setVarsOpen(false)} footer={<button className="btn btn-primary" onClick={() => setVarsOpen(false)}>Pronto</button>}>
          <p className="muted small">Clique para inserir no texto selecionado (ou numa nova caixa). Na hora de gerar, cada variável vira o dado do cliente: use <strong>Ver com cliente</strong> para conferir e imprimir.</p>
          <VariablePicker onPick={(k) => insertVariable(k)} />
        </Modal>
      )}
      {busy && <div className="ce-busy" role="status">{busy}</div>}

      {leave && (
        <Modal title="Não foi possível salvar" onClose={() => setLeave(false)}
          footer={<><button className="btn btn-ghost" onClick={() => setLeave(false)}>Continuar editando</button><button className="btn btn-danger" onClick={() => { version.current = savedVersion.current; nav('/contratos'); }}>Sair sem salvar</button></>}>
          <p>Suas últimas alterações ainda não foram salvas. Se sair agora, elas serão perdidas.</p>
        </Modal>
      )}
    </div>
  );
}
