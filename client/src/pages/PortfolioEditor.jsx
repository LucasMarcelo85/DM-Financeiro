import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import Modal from '../components/Modal.jsx';
import EIcon from '../components/contract/EIcon.jsx';
import PortfolioView from '../components/portfolio/PortfolioView.jsx';
import PortfolioInspector from '../components/portfolio/PortfolioInspector.jsx';
import ShareModal from '../components/portfolio/ShareModal.jsx';
import {
  BLOCK_LABELS, MAX_BLOCKS, duplicateBlock, findBlock, insertBlock, moveBlock, newBlock, normalizeDoc, pageUrl, patchBlock, patchSeo, patchTheme, removeBlock,
} from '../lib/portfolio/model.js';
import { copyText } from '../lib/portfolio/share.js';

const PALETTE = [
  { t: 'banner', icon: 'banner' }, { t: 'logo', icon: 'logo' }, { t: 'heading', icon: 'title' }, { t: 'text', icon: 'text' },
  { t: 'image', icon: 'image' }, { t: 'gallery', icon: 'gallery' }, { t: 'video', icon: 'video' }, { t: 'button', icon: 'button' },
  { t: 'divider', icon: 'divider' }, { t: 'spacer', icon: 'spacer' },
];
const SAVE_LABEL = { saved: 'Salvo', dirty: 'Alterações não salvas', saving: 'Salvando...', error: 'Erro ao salvar' };

export default function PortfolioEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();

  const [doc, setDocState] = useState(null);
  const [meta, setMeta] = useState(null); // { slug, published, isMain, path, customUrl }
  const [name, setName] = useState('');
  const [saveState, setSaveState] = useState('saved');
  const [selectedId, setSelectedId] = useState(null);
  const [device, setDevice] = useState('mobile'); // 'mobile' | 'desktop'
  const [preview, setPreview] = useState(false);
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState('');
  const [leave, setLeave] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const docRef = useRef(null);
  const nameRef = useRef('');
  const past = useRef([]);
  const future = useRef([]);
  const lastKey = useRef({ key: null, t: 0 });
  const version = useRef(0); // sobe a cada alteração
  const savedVersion = useRef(0);
  const saving = useRef(false);
  const selectedRef = useRef(null);
  selectedRef.current = selectedId;
  nameRef.current = name;

  // ---------------------------------------------------------------- carregar
  useEffect(() => {
    let alive = true;
    api.get(`/portfolios/${id}`)
      .then(({ portfolio: p }) => {
        if (!alive) return;
        const d = normalizeDoc(p.data);
        docRef.current = d;
        setDocState(d);
        setName(p.name);
        setMeta({ slug: p.slug, published: p.published, isMain: p.isMain, path: p.path, customUrl: p.customUrl });
      })
      .catch((e) => { toast(e.message, 'error'); nav('/portfolio', { replace: true }); });
    return () => { alive = false; };
  }, [id, nav, toast]);

  // ---------------------------------------------------------------- histórico
  const touch = useCallback(() => { version.current += 1; setSaveState('dirty'); }, []);

  // `key` agrupa alterações seguidas (digitar, arrastar uma barra, escolher cor) em um único passo de "desfazer".
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
    setSelectedId((s) => (s && findBlock(d, s) ? s : null));
    touch();
  }, [touch]);
  const undo = useCallback(() => jump(past, future), [jump]);
  const redo = useCallback(() => jump(future, past), [jump]);

  const selected = useMemo(() => (doc && selectedId ? findBlock(doc, selectedId) : null), [doc, selectedId]);
  const selectedIndex = selected ? doc.blocks.findIndex((b) => b.id === selected.id) : -1;

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
    if (version.current === savedVersion.current) return nav('/portfolio');
    if (await save()) nav('/portfolio'); else setLeave(true);
    return undefined;
  }

  // ---------------------------------------------------------------- publicar e compartilhar
  async function setPublished(value) {
    if (busy) return;
    setBusy('publish');
    try {
      if (!(await save())) return; // não publica com alterações que não foram salvas
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

  // ---------------------------------------------------------------- blocos
  function addBlock(t) {
    const d = docRef.current;
    if (d.blocks.length >= MAX_BLOCKS) { toast(`A página aceita até ${MAX_BLOCKS} blocos.`, 'error'); return; }
    const block = newBlock(t);
    commit(insertBlock(d, block, selectedRef.current));
    setSelectedId(block.id);
    setPreview(false);
    setPanelOpen(true);
    setTimeout(() => document.querySelector(`[data-block="${block.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
  }

  const patchSelected = useCallback((patch, key) => {
    const sel = selectedRef.current;
    if (sel) commit(patchBlock(docRef.current, sel, patch), key ? `${sel}:${key}` : `${sel}:${Object.keys(patch).join(',')}`);
  }, [commit]);

  function move(from, to) { commit(moveBlock(docRef.current, from, to)); }

  function duplicate(blockId) {
    const d = docRef.current;
    if (d.blocks.length >= MAX_BLOCKS) { toast(`A página aceita até ${MAX_BLOCKS} blocos.`, 'error'); return; }
    const r = duplicateBlock(d, blockId);
    if (r.block) { commit(r.doc); setSelectedId(r.block.id); }
  }

  function remove(blockId) {
    commit(removeBlock(docRef.current, blockId));
    setSelectedId((s) => (s === blockId ? null : s));
  }

  function act(action) {
    const sel = selectedRef.current;
    if (!sel) return;
    const i = docRef.current.blocks.findIndex((b) => b.id === sel);
    if (action === 'delete') remove(sel);
    else if (action === 'duplicate') duplicate(sel);
    else if (action === 'up') move(i, i - 1);
    else if (action === 'down') move(i, i + 1);
  }

  const view = useMemo(() => ({
    select: (blockId) => { setSelectedId(blockId); setPanelOpen(true); },
    move, duplicate, remove,
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const inspectorApi = useMemo(() => ({
    patch: patchSelected,
    patchTheme: (p, key) => commit(patchTheme(docRef.current, p), key || 'theme'),
    patchSeo: (p, key) => commit(patchSeo(docRef.current, p), key || 'seo'),
    act, toast, saveSlug, copyLink,
  }), [patchSelected, commit, toast, meta?.path]); // eslint-disable-line react-hooks/exhaustive-deps

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
      else if (mod && key === 'd' && selectedRef.current) { e.preventDefault(); act('duplicate'); }
      else if (!mod && (key === 'delete' || key === 'backspace') && selectedRef.current) { e.preventDefault(); act('delete'); }
      else if (key === 'escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!doc || !meta) return <div className="splash"><span className="lamp lamp-lg is-pending" /></div>;

  return (
    <div className="ce pe">
      <header className="ce-top">
        <button type="button" className="btn btn-ghost btn-sm" onClick={goBack}><EIcon name="back" size={16} /> Portfólio</button>
        <input
          className="input input-sm ce-name"
          value={name}
          maxLength={120}
          aria-label="Nome da página"
          onChange={(e) => { setName(e.target.value); touch(); }}
          onBlur={() => { if (!name.trim()) { setName('Página sem título'); touch(); } }}
        />
        <span className={`ce-status is-${saveState}`} role="status">{SAVE_LABEL[saveState]}</span>
        <span className={`pe-pub ${meta.published ? 'is-on' : ''}`}>{meta.published ? 'Publicada' : 'Rascunho'}</span>
        <span className="ce-grow" />
        <div className="seg seg-view pe-device-seg" role="radiogroup" aria-label="Tamanho da tela">
          <button role="radio" aria-checked={device === 'mobile'} className={device === 'mobile' ? 'is-on' : ''} onClick={() => setDevice('mobile')} title="Ver como no celular"><EIcon name="mobile" size={16} /> <span className="ce-lbl">Celular</span></button>
          <button role="radio" aria-checked={device === 'desktop'} className={device === 'desktop' ? 'is-on' : ''} onClick={() => setDevice('desktop')} title="Ver como no computador"><EIcon name="desktop" size={16} /> <span className="ce-lbl">Computador</span></button>
        </div>
        <button type="button" className="ce-mini" onClick={undo} disabled={!past.current.length} title="Desfazer (Ctrl+Z)" aria-label="Desfazer"><EIcon name="undo" /></button>
        <button type="button" className="ce-mini" onClick={redo} disabled={!future.current.length} title="Refazer (Ctrl+Y)" aria-label="Refazer"><EIcon name="redo" /></button>
        <button type="button" className={`btn btn-ghost btn-sm ${preview ? 'is-on' : ''}`} aria-pressed={preview} onClick={() => { setPreview((p) => !p); setSelectedId(null); }} title="Ver a página sem as ferramentas de edição">
          <Eye /> <span className="ce-lbl">{preview ? 'Voltar a editar' : 'Visualizar'}</span>
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPublished(!meta.published)} disabled={!!busy}>
          {busy === 'publish' ? 'Aguarde...' : meta.published ? 'Despublicar' : 'Publicar'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShare(true)}><EIcon name="share" size={16} /> <span className="ce-lbl">Compartilhar</span></button>
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saveState === 'saving' || saveState === 'saved'}>Salvar</button>
      </header>

      <div className="ce-body">
        <nav className="ce-palette" aria-label="Adicionar blocos">
          {PALETTE.map((p) => (
            <button key={p.t} type="button" className="ce-tool" onClick={() => addBlock(p.t)} title={`Adicionar ${BLOCK_LABELS[p.t].toLowerCase()}`}>
              <EIcon name={p.icon} size={20} />
              <span>{BLOCK_LABELS[p.t]}</span>
            </button>
          ))}
        </nav>

        <main className="ce-stage pe-stage" onClick={() => setSelectedId(null)}>
          <div className={`pe-device is-${device}`}>
            <PortfolioView doc={doc} editing={!preview} selectedId={selectedId} on={view} />
          </div>
        </main>

        <aside className={`ce-side ${panelOpen ? 'is-open' : ''}`} aria-label="Propriedades">
          <button type="button" className="ce-side-toggle" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
            {panelOpen ? 'Fechar propriedades' : selected ? `Propriedades: ${BLOCK_LABELS[selected.t]}` : 'Propriedades da página'}
          </button>
          <PortfolioInspector block={selected} doc={doc} meta={meta} index={selectedIndex} count={doc.blocks.length} api={inspectorApi} />
        </aside>
      </div>

      {share && <ShareModal name={name} path={meta.path} customUrl={meta.customUrl} published={meta.published} busy={busy === 'publish'} onPublish={() => setPublished(true)} onClose={() => setShare(false)} />}

      {leave && (
        <Modal title="Não foi possível salvar" onClose={() => setLeave(false)}
          footer={<><button className="btn btn-ghost" onClick={() => setLeave(false)}>Continuar editando</button><button className="btn btn-danger" onClick={() => { version.current = savedVersion.current; nav('/portfolio'); }}>Sair sem salvar</button></>}>
          <p>Suas últimas alterações ainda não foram salvas. Se sair agora, elas serão perdidas.</p>
        </Modal>
      )}
    </div>
  );
}

const Eye = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
  </svg>
);
