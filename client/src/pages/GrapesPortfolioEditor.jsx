import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import grapesjs from 'grapesjs';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import Modal from '../components/Modal.jsx';
import { cleanGrapesCss } from '../lib/portfolio/grapesCss.js';
import { cleanGrapesHtml, makeGrapesFrameDocument } from '../lib/portfolio/grapesPreview.js';
import '../lib/portfolio/grapesEditor.css';
import 'grapesjs/dist/css/grapes.min.css';

const HTML_IMPORT_LIMIT = 1024 * 1024;
const IMAGE_LIMIT = 2 * 1024 * 1024;
const SAVE_STATUS = { saved: 'Salvo', dirty: 'Alterações não salvas', saving: 'Salvando...', error: 'Erro ao salvar' };

export default function GrapesPortfolioEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const canvasRef = useRef(null);
  const editorRef = useRef(null);
  const initializing = useRef(true);
  const saveVersion = useRef(0);
  const savedVersion = useRef(0);
  const [page, setPage] = useState(null);
  const [name, setName] = useState('');
  const [published, setPublished] = useState(false);
  const [canSave, setCanSave] = useState(false);
  const [status, setStatus] = useState('saved');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [htmlToolOpen, setHtmlToolOpen] = useState(false);
  const [htmlText, setHtmlText] = useState('');
  const [cssText, setCssText] = useState('');
  const [previewSrc, setPreviewSrc] = useState('');
  const [device, setDevice] = useState('Desktop');
  const fileInput = useRef(null);
  const imageInput = useRef(null);

  const markDirty = useCallback(() => {
    if (initializing.current) return;
    saveVersion.current += 1;
    setStatus('dirty');
  }, []);
  const markCanvasDirty = useCallback(() => {
    if (initializing.current) return;
    setCanSave(true);
    markDirty();
  }, [markDirty]);

  const addImageFiles = useCallback(async (files) => {
    const editor = editorRef.current;
    if (!editor) return;
    for (const file of files) {
      if (!file.type.startsWith('image/') || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
        toast('Use uma imagem PNG, JPG, WebP ou GIF.', 'error');
        continue;
      }
      if (file.size > IMAGE_LIMIT) {
        toast('Cada imagem pode ter no máximo 2 MB. Reduza o arquivo e tente novamente.', 'error');
        continue;
      }
      const source = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Não foi possível ler esta imagem.'));
        reader.readAsDataURL(file);
      }).catch((readError) => {
        toast(readError.message, 'error');
        return null;
      });
      if (source) editor.AssetManager.add({ src: source, name: file.name });
    }
  }, [toast]);

  useEffect(() => {
    let active = true;
    api.get(`/portfolios/${id}`).then(({ portfolio }) => {
      if (!active) return;
      if (portfolio.kind === 'catalog') {
        toast('Páginas de catálogo usam o editor especializado para manter pedidos e produtos ativos.', 'error');
        navigate(`/portfolio/${id}`, { replace: true });
        return;
      }
      setPage(portfolio);
      setName(portfolio.name);
      setPublished(portfolio.published);
      if (portfolio.data?.editor === 'grapesjs') {
        setCanSave(true);
      }
    }).catch((loadError) => {
      if (!active) return;
      toast(loadError.message, 'error');
      navigate('/portfolio', { replace: true });
    });
    return () => { active = false; };
  }, [id, navigate, toast]);

  useEffect(() => {
    if (!page || !canvasRef.current || editorRef.current) return undefined;
    initializing.current = true;
    const editor = grapesjs.init({
      container: canvasRef.current,
      height: '100%',
      width: 'auto',
      fromElement: false,
      storageManager: false,
      noticeOnUnload: false,
      selectorManager: { componentFirst: true },
      deviceManager: {
        devices: [
          { name: 'Desktop', width: '' },
          { name: 'Tablet', width: '768px', widthMedia: '992px' },
          { name: 'Celular', width: '375px', widthMedia: '575px' },
        ],
      },
      panels: { defaults: [] },
      assetManager: {
        assets: [],
        uploadFile: (event) => {
          const files = event.dataTransfer?.files || event.target?.files;
          if (files?.length) addImageFiles([...files]);
        },
      },
      canvas: {
        styles: [],
        scripts: [],
        frameStyle: 'body{margin:0;padding:0;min-height:100vh;}',
      },
      projectData: {},
    });
    editorRef.current = editor;
    if (page.data?.editor === 'grapesjs') {
      editor.setComponents(cleanGrapesHtml(page.data.html || ''));
      editor.setStyle(cleanGrapesCss(page.data.css || ''));
    }
    editor.on('update', markCanvasDirty);
    requestAnimationFrame(() => { initializing.current = false; });
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, [page, markCanvasDirty, addImageFiles]);

  useEffect(() => {
    if (page && page.data?.editor !== 'grapesjs') setHtmlToolOpen(true);
  }, [page]);

  useEffect(() => {
    const warn = (event) => {
      if (saveVersion.current !== savedVersion.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const getDocument = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) throw new Error('O editor ainda está carregando.');
    const html = cleanGrapesHtml(editor.getHtml());
    const css = cleanGrapesCss(editor.getCss());
    return {
      editor: 'grapesjs',
      title: name.trim().slice(0, 120),
      description: '',
      html,
      css,
    };
  }, [name]);

  const save = useCallback(async () => {
    if (status === 'saving') return false;
    if (!canSave) {
      toast('Insira o HTML e o CSS da página para começar a editar no canvas.', 'error');
      return false;
    }
    setStatus('saving');
    const version = saveVersion.current;
    try {
      const data = getDocument();
      await api.patch(`/portfolios/${id}`, { name: name.trim() || 'Página sem título', data });
      savedVersion.current = version;
      setStatus(saveVersion.current === version ? 'saved' : 'dirty');
      setError('');
      return true;
    } catch (saveError) {
      setStatus('error');
      setError(saveError.message);
      toast(saveError.message, 'error');
      return false;
    }
  }, [canSave, getDocument, id, name, status, toast]);

  const openHtmlTool = () => {
    const editor = editorRef.current;
    if (editor && canSave) {
      setHtmlText(editor.getHtml());
      setCssText(editor.getCss());
    } else {
      setHtmlText('');
      setCssText('');
    }
    setHtmlToolOpen(true);
  };

  const applyHtmlToCanvas = () => {
    if (!editorRef.current) return;
    if (htmlText.length > HTML_IMPORT_LIMIT || cssText.length > HTML_IMPORT_LIMIT) {
      toast('O HTML e o CSS podem ter no máximo 1 MB cada.', 'error');
      return;
    }
    try {
      const parsed = new DOMParser().parseFromString(htmlText, 'text/html');
      const stylesheet = [...parsed.querySelectorAll('style')].map((style) => style.textContent || '').join('\n');
      const content = parsed.body.innerHTML || htmlText;
      const clean = cleanGrapesHtml(content);
      const css = cleanGrapesCss([stylesheet, cssText].filter(Boolean).join('\n'));
      initializing.current = true;
      editorRef.current.setComponents(clean);
      editorRef.current.setStyle(css);
      setHtmlToolOpen(false);
      requestAnimationFrame(() => { initializing.current = false; markCanvasDirty(); });
      toast('HTML e CSS carregados no canvas para edição visual. Scripts e conteúdo ativo foram removidos.');
    } catch (importError) {
      toast(importError.message, 'error');
    }
  };

  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > HTML_IMPORT_LIMIT) {
      toast('O arquivo HTML pode ter no máximo 1 MB.', 'error');
      return;
    }
    try {
      setHtmlText(await file.text());
      setCssText('');
      setHtmlToolOpen(true);
    } catch (fileError) { toast(fileError.message, 'error'); }
  }

  async function publish(value) {
    if (busy) return;
    setBusy('publish');
    try {
      if (!(await save())) return;
      await api.patch(`/portfolios/${id}`, { published: value });
      setPublished(value);
      toast(value ? 'Página compilada e publicada.' : 'Página despublicada.');
    } catch (publishError) {
      toast(publishError.message, 'error');
    } finally { setBusy(''); }
  }

  function togglePreview() {
    try {
      const doc = getDocument();
      setPreviewSrc(makeGrapesFrameDocument(doc.html, doc.css));
      setShowPreview(true);
    } catch (previewError) { toast(previewError.message, 'error'); }
  }

  function openMediaManager() {
    const editor = editorRef.current;
    if (!editor) return;
    editor.AssetManager.open({
      types: ['image'],
      select: (asset, complete) => {
        const selected = editor.getSelected();
        if (selected?.is('image')) selected.addAttributes({ src: asset.getSrc() });
        else toast('Selecione uma imagem no canvas antes de escolher um arquivo da biblioteca.', 'error');
        if (complete) editor.AssetManager.close();
      },
    });
  }

  function goToPortfolioEditor() {
    if (saveVersion.current !== savedVersion.current && !window.confirm('Há alterações não salvas. Sair sem salvar?')) return;
    navigate(`/portfolio/${id}`);
  }

  if (!page) {
    return <div className="gpe-loading"><span className="lamp lamp-lg is-pending" /> Carregando canvas...</div>;
  }

  return (
    <div className="gpe">
      <header className="gpe-toolbar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={goToPortfolioEditor}><span aria-hidden="true">←</span> Portfólio</button>
        <input className="input gpe-name" value={name} onChange={(event) => { setName(event.target.value); markDirty(); }} aria-label="Nome da página" maxLength={120} />
        <span className={`gpe-status is-${status}`} role="status">{SAVE_STATUS[status]}</span>
        <div className="gpe-device-picker" role="group" aria-label="Tamanho da prévia">
          {['Desktop', 'Tablet', 'Celular'].map((size) => <button key={size} type="button" className={device === size ? 'is-selected' : ''} aria-pressed={device === size} onClick={() => { editorRef.current?.setDevice(size); setDevice(size); }}>{size}</button>)}
        </div>
        <div className="gpe-toolbar-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={openMediaManager}>Gerenciar mídias</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => imageInput.current?.click()}>Enviar imagem</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={openHtmlTool}>HTML/CSS</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={togglePreview}>Visualizar</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => publish(!published)} disabled={!!busy}>{busy === 'publish' ? 'Publicando...' : published ? 'Despublicar' : 'Publicar'}</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!canSave || status === 'saved' || status === 'saving'}>{status === 'saving' ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </header>
      <main className="gpe-canvas">
        <div ref={canvasRef} className="gpe-editor-canvas" />
        {!canSave && <div className="gpe-empty"><strong>Seu canvas está vazio</strong><span>Insira seu HTML e CSS para carregar a página e editá-la visualmente.</span><button type="button" className="btn btn-primary" onClick={openHtmlTool}>Inserir HTML/CSS</button></div>}
        {error && <p className="gpe-error" role="alert">{error}</p>}
      </main>
      <input ref={fileInput} hidden type="file" accept=".html,.htm,text/html" onChange={importFile} />
      <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(event) => { addImageFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
      {htmlToolOpen && (
        <Modal
          title="Ferramenta HTML"
          onClose={() => setHtmlToolOpen(false)}
          wide
          footer={(
            <>
              <button type="button" className="btn btn-ghost" onClick={() => fileInput.current?.click()}>Importar arquivo HTML</button>
              <button type="button" className="btn btn-ghost" onClick={() => setHtmlToolOpen(false)}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={applyHtmlToCanvas} disabled={!htmlText.trim()}>Carregar no canvas</button>
            </>
          )}
        >
          <p className="muted">Cole o HTML e o CSS da página. O conteúdo será carregado no canvas para edição visual. O CSS em tags <code>&lt;style&gt;</code> do HTML também será aplicado. Scripts, iframes e conteúdo ativo são removidos.</p>
          <div className="gpe-code-fields">
            <label>
              <span>HTML</span>
              <textarea
                className="input gpe-import-text"
                value={htmlText}
                onChange={(event) => setHtmlText(event.target.value)}
                maxLength={HTML_IMPORT_LIMIT}
                placeholder={'<section>\n  <h1>Minha página</h1>\n  <p>Meu conteúdo</p>\n</section>'}
                aria-label="HTML da página"
                spellCheck={false}
                autoFocus
              />
            </label>
            <label>
              <span>CSS</span>
              <textarea
                className="input gpe-import-css"
                value={cssText}
                onChange={(event) => setCssText(event.target.value)}
                maxLength={HTML_IMPORT_LIMIT}
                placeholder={'body { font-family: Arial, sans-serif; }\nsection { padding: 48px; }'}
                aria-label="CSS da página"
                spellCheck={false}
              />
            </label>
          </div>
          <span className="gpe-html-import-limit">HTML {htmlText.length.toLocaleString('pt-BR')} / 1.048.576 · CSS {cssText.length.toLocaleString('pt-BR')} / 1.048.576 caracteres</span>
        </Modal>
      )}
      {showPreview && (
        <div className="gpe-preview-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowPreview(false); }}>
          <section className="gpe-preview-dialog" role="dialog" aria-modal="true" aria-label="Prévia isolada da página">
            <header><strong>Pré-visualização isolada</strong><button className="btn btn-ghost btn-sm" onClick={() => setShowPreview(false)}>Fechar</button></header>
            <iframe title="Prévia segura do portfólio" sandbox="" srcDoc={previewSrc} />
          </section>
        </div>
      )}
    </div>
  );
}
