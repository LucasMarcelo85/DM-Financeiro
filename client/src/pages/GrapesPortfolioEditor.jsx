import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import grapesjs from 'grapesjs';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { GRAPES_BLOCKS, GRAPES_TEMPLATES } from '../lib/portfolio/grapesTemplates.js';
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
  const [importText, setImportText] = useState('');
  const [previewSrc, setPreviewSrc] = useState('');
  const [templateKey, setTemplateKey] = useState('');
  const [device, setDevice] = useState('Desktop');
  const fileInput = useRef(null);
  const imageInput = useRef(null);
  const htmlInput = useRef(null);

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
        setTemplateKey('saved');
        setCanSave(true);
      }
      else setTemplateKey('');
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
      blockManager: { appendTo: '#gpe-blocks' },
      styleManager: {
        appendTo: '#gpe-styles',
        sectors: [
          { name: 'Layout', open: true, properties: ['display', 'position', 'top', 'right', 'left', 'bottom', 'width', 'height', 'max-width', 'min-height', 'margin', 'padding', 'gap'] },
          { name: 'Tipografia', open: false, properties: ['font-family', 'font-size', 'font-weight', 'letter-spacing', 'color', 'line-height', 'text-align', 'text-decoration'] },
          { name: 'Fundo', open: false, properties: ['background-color', 'background', 'background-image', 'background-size', 'background-position'] },
          { name: 'Bordas e efeitos', open: false, properties: ['border', 'border-radius', 'box-shadow', 'opacity'] },
          { name: 'Avançado', open: false, properties: ['overflow', 'z-index', 'cursor', 'transition'] },
        ],
      },
      layerManager: { appendTo: '#gpe-layers' },
      traitManager: { appendTo: '#gpe-traits' },
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
    for (const block of GRAPES_BLOCKS) {
      editor.BlockManager.add(block.id, {
        label: block.label,
        category: block.category,
        content: block.content,
        activate: false,
      });
    }
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
      toast('Adicione um bloco, escolha um modelo ou importe HTML antes de salvar esta página neste editor.', 'error');
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

  const applyTemplate = (template) => {
    if (!editorRef.current) return;
    if (page?.data?.editor !== 'grapesjs' && page?.data?.v && !window.confirm('Esta página usa o editor atual. Ao salvar aqui, o conteúdo antigo será substituído pelo modelo escolhido. Quer continuar?')) return;
    initializing.current = true;
    editorRef.current.setComponents(template.html);
    editorRef.current.setStyle(template.css);
    setTemplateKey(template.id);
    requestAnimationFrame(() => { initializing.current = false; markCanvasDirty(); });
  };

  const importHtml = (source) => {
    if (!editorRef.current) return;
    if (source.length > HTML_IMPORT_LIMIT) {
      toast('O HTML pode ter no máximo 1 MB.', 'error');
      return;
    }
    try {
      const parsed = new DOMParser().parseFromString(source, 'text/html');
      const stylesheet = [...parsed.querySelectorAll('style')].map((style) => style.textContent || '').join('\n');
      const content = parsed.body.innerHTML || source;
      const clean = cleanGrapesHtml(content);
      const css = stylesheet ? cleanGrapesCss(stylesheet) : '';
      initializing.current = true;
      editorRef.current.setComponents(clean);
      if (css) editorRef.current.setStyle(css);
      setTemplateKey('imported');
      requestAnimationFrame(() => { initializing.current = false; markCanvasDirty(); });
      toast('HTML importado e analisado pelo editor. Scripts e conteúdo ativo foram removidos.');
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
      setImportText(await file.text());
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

  function goToPreviousEditor() {
    if (saveVersion.current !== savedVersion.current && !window.confirm('Há alterações não salvas. Sair sem salvar?')) return;
    navigate(`/portfolio/${id}`);
  }

  if (!page) {
    return <div className="gpe-loading"><span className="lamp lamp-lg is-pending" /> Carregando editor de blocos...</div>;
  }

  const savedEditor = page.data?.editor === 'grapesjs';
  return (
    <div className="gpe">
      <header className="gpe-toolbar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={goToPreviousEditor}><span aria-hidden="true">←</span> Editor anterior</button>
        <input className="input gpe-name" value={name} onChange={(event) => { setName(event.target.value); markDirty(); }} aria-label="Nome da página" maxLength={120} />
        <span className={`gpe-status is-${status}`} role="status">{SAVE_STATUS[status]}</span>
        <div className="gpe-device-picker" role="group" aria-label="Tamanho da prévia">
          {['Desktop', 'Tablet', 'Celular'].map((size) => <button key={size} type="button" className={device === size ? 'is-selected' : ''} aria-pressed={device === size} onClick={() => { editorRef.current?.setDevice(size); setDevice(size); }}>{size}</button>)}
        </div>
        <div className="gpe-toolbar-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={openMediaManager}>Gerenciar mídias</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => imageInput.current?.click()}>Adicionar imagem</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileInput.current?.click()}>Importar HTML</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { htmlInput.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); htmlInput.current?.focus(); }}>Colar HTML</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={togglePreview}>Visualizar</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => publish(!published)} disabled={!!busy}>{busy === 'publish' ? 'Publicando...' : published ? 'Despublicar' : 'Publicar'}</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!canSave || status === 'saved' || status === 'saving'}>{status === 'saving' ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </header>
      {!savedEditor && page.data?.v && <div className="gpe-notice">Esta página está no editor anterior e ainda não foi alterada. Escolha um modelo ou importe HTML; ao salvar, o conteúdo antigo será substituído. Você pode voltar ao editor anterior antes de salvar.</div>}
      <section className="gpe-html-import" aria-labelledby="gpe-html-title">
        <div className="gpe-html-import-heading">
          <div>
            <h2 id="gpe-html-title">Cole o HTML para criar ou substituir o conteúdo da página</h2>
            <p>O HTML será convertido em blocos visuais editáveis. Scripts, iframes e conteúdo ativo serão removidos.</p>
          </div>
          <div className="gpe-html-import-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileInput.current?.click()}>Abrir arquivo HTML</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => importHtml(importText)} disabled={!importText.trim()}>Converter HTML em blocos</button>
          </div>
        </div>
        <textarea
          ref={htmlInput}
          className="input gpe-import-text"
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          maxLength={HTML_IMPORT_LIMIT}
          placeholder={'Cole aqui o código HTML completo da página, por exemplo:\n<section><h1>Minha página</h1><p>Meu conteúdo</p></section>'}
          aria-label="HTML da página para converter em blocos editáveis"
          spellCheck={false}
        />
        <span className="gpe-html-import-limit">{importText.length.toLocaleString('pt-BR')} / 1.048.576 caracteres</span>
      </section>
      <div className="gpe-template-bar">
        <strong>Modelos prontos</strong>
        {GRAPES_TEMPLATES.map((template) => <button key={template.id} type="button" className={templateKey === template.id ? 'is-selected' : ''} onClick={() => applyTemplate(template)}>{template.name}</button>)}
        <span>Referências: MUI, Bootstrap e Tailwind. O editor não carrega essas bibliotecas automaticamente.</span>
      </div>
      <div className="gpe-workspace">
        <aside className="gpe-sidebar">
          <div className="gpe-sidebar-tabs">
            <button type="button" onClick={() => { document.getElementById('gpe-blocks')?.scrollIntoView({ block: 'start' }); }}>Blocos</button>
            <button type="button" onClick={() => { document.getElementById('gpe-layers')?.scrollIntoView({ block: 'start' }); }}>Camadas</button>
            <button type="button" onClick={() => { document.getElementById('gpe-styles')?.scrollIntoView({ block: 'start' }); }}>Estilos CSS</button>
          </div>
          <section><h2>Blocos permitidos</h2><div id="gpe-blocks" /></section>
          <section><h2>Estrutura e camadas</h2><div id="gpe-layers" /></section>
        </aside>
        <main className="gpe-canvas">
          <div ref={canvasRef} className="gpe-editor-canvas" />
          {error && <p className="gpe-error" role="alert">{error}</p>}
        </main>
        <aside className="gpe-properties">
          <section><h2>Propriedades do elemento</h2><div id="gpe-traits" /></section>
          <section><h2>Estilos CSS</h2><div id="gpe-styles" /></section>
        </aside>
      </div>
      <input ref={fileInput} hidden type="file" accept=".html,.htm,text/html" onChange={importFile} />
      <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(event) => { addImageFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />
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
