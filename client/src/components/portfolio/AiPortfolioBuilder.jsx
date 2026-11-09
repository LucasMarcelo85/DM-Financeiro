import { useEffect, useState } from 'react';
import { api, getActiveStore, isShopMode, shopSlug } from '../../api.js';
import Icon from '../Icon.jsx';
import Modal from '../Modal.jsx';
import { useToast } from '../Toast.jsx';

const PROVIDERS = {
  gemini: { label: 'Google Gemini', model: 'gemini-2.0-flash' },
  openai: { label: 'OpenAI', model: 'gpt-4o-mini' },
  claude: { label: 'Anthropic Claude', model: 'claude-3-5-haiku-latest' },
};
const MAX_FILES = 5;
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_ATTACHMENT_BASE64 = 510_000;
const credentialKey = (scope, provider) => `dm:portfolio-ai-key:v1:${encodeURIComponent(scope)}:${provider}`;
function readCredential(key) {
  try { return { value: localStorage.getItem(key) || '', error: '' }; } catch {
    return { value: '', error: 'O navegador bloqueou o armazenamento local. A chave não poderá ser lembrada neste dispositivo.' };
  }
}
function writeCredential(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
    return '';
  } catch {
    return 'O navegador bloqueou o armazenamento local. A chave não foi salva e precisará ser informada novamente.';
  }
}
function clearCredentials(scope) {
  for (const provider of Object.keys(PROVIDERS)) {
    const error = writeCredential(credentialKey(scope, provider), '');
    if (error) return error;
  }
  return '';
}
const waitFor = (target, eventName) => new Promise((resolve, reject) => {
  if ((eventName === 'loadedmetadata' && target.readyState >= 1) || (eventName === 'loadeddata' && target.readyState >= 2)) {
    resolve();
    return;
  }
  const cleanup = () => {
    clearTimeout(timer);
    target.removeEventListener(eventName, onReady);
    target.removeEventListener('error', onError);
  };
  const onReady = () => { cleanup(); resolve(); };
  const onError = () => { cleanup(); reject(new Error('Não foi possível ler a mídia enviada. Tente outro arquivo.')); };
  const timer = setTimeout(() => { cleanup(); reject(new Error('Não foi possível ler a mídia enviada. Tente outro arquivo.')); }, 12000);
  target.addEventListener(eventName, onReady);
  target.addEventListener('error', onError);
});

function jpegAttachment(canvas, name) {
  let source = canvas;
  let quality = 0.82;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const dataUrl = source.toDataURL('image/jpeg', quality);
    const base64 = dataUrl.split(',')[1];
    if (base64.length <= MAX_ATTACHMENT_BASE64) return { name, mime: 'image/jpeg', base64 };
    if (quality > 0.52) {
      quality = Math.max(0.52, quality - 0.1);
      continue;
    }
    const smaller = document.createElement('canvas');
    smaller.width = Math.max(1, Math.round(source.width * 0.8));
    smaller.height = Math.max(1, Math.round(source.height * 0.8));
    const context = smaller.getContext('2d');
    if (!context) break;
    context.drawImage(source, 0, 0, smaller.width, smaller.height);
    source = smaller;
    quality = 0.72;
  }
  throw new Error(`Não foi possível reduzir "${name}" para enviar à IA. Escolha um arquivo menor.`);
}

function MediaPreview({ file }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);
  if (!url) return <span className="ai-site-file-placeholder" aria-hidden="true" />;
  return file.type.startsWith('video/')
    ? <video className="ai-site-file-thumb" src={url} muted playsInline preload="metadata" aria-label={`Prévia de ${file.name}`} />
    : <img className="ai-site-file-thumb" src={url} alt={`Prévia de ${file.name}`} />;
}

async function imageAttachment(file) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Este navegador não conseguiu preparar a imagem.');
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
  } else {
    const url = URL.createObjectURL(file);
    const image = new Image();
    try {
      const loaded = waitFor(image, 'load');
      image.src = url;
      await loaded;
      const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return jpegAttachment(canvas, file.name);
}

async function videoAttachments(file) {
  const video = document.createElement('video');
  const url = URL.createObjectURL(file);
  video.preload = 'auto';
  video.muted = true;
  try {
    const metadata = waitFor(video, 'loadedmetadata');
    video.src = url;
    await metadata;
    if (video.error) throw new Error('O vídeo não pôde ser decodificado neste navegador.');
    if (video.readyState < 2) await waitFor(video, 'loadeddata');
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!video.videoWidth || !video.videoHeight || duration <= 0) throw new Error('O vídeo não contém quadros que possam ser lidos.');
    const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    const times = [...new Set([0, Math.min(duration / 2, 4), Math.max(0, duration - 0.25)])];
    const frames = [];
    for (let index = 0; index < times.length; index += 1) {
      if (times[index] > 0) {
        const seek = waitFor(video, 'seeked');
        video.currentTime = times[index];
        await seek;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(jpegAttachment(canvas, `${file.name} - quadro ${index + 1}`));
    }
    return frames;
  } finally {
    video.pause();
    video.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}

async function prepareAttachments(files) {
  const attachments = [];
  for (const file of files) {
    if (file.type.startsWith('video/')) attachments.push(...await videoAttachments(file));
    else attachments.push(await imageAttachment(file));
  }
  if (attachments.length > MAX_FILES * 3) throw new Error('Use até cinco arquivos de referência no total.');
  const totalBytes = attachments.reduce((sum, attachment) => sum + Math.ceil(attachment.base64.length * 3 / 4), 0);
  if (totalBytes > 6_000_000) throw new Error('As imagens e quadros de vídeo juntos ultrapassam o limite de 6 MB. Remova alguns arquivos e tente novamente.');
  return attachments;
}

export default function AiPortfolioBuilder({ onClose, onCreated, availablePages = 1, credentialScope }) {
  const toast = useToast();
  const [scope] = useState(() => credentialScope || (isShopMode()
    ? `shop:${shopSlug()}`
    : `user:main:${getActiveStore() || 'main'}`));
  const [provider, setProvider] = useState('gemini');
  const [model, setModel] = useState(PROVIDERS.gemini.model);
  const [rememberKey, setRememberKey] = useState(true);
  const [apiKey, setApiKey] = useState(() => readCredential(credentialKey(scope, 'gemini')).value);
  const [siteName, setSiteName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [pageCount, setPageCount] = useState(1);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState(() => readCredential(credentialKey(scope, 'gemini')).error);

  function changeProvider(next) {
    setProvider(next);
    setModel(PROVIDERS[next].model);
    const saved = rememberKey ? readCredential(credentialKey(scope, next)) : { value: '', error: '' };
    setApiKey(saved.value);
    setStorageWarning(saved.error);
  }

  function toggleRemember(checked) {
    setRememberKey(checked);
    if (!checked) {
      setStorageWarning(clearCredentials(scope));
      return;
    }
    setStorageWarning(apiKey ? writeCredential(credentialKey(scope, provider), apiKey) : '');
  }

  function clearSavedKey() {
    setStorageWarning(writeCredential(credentialKey(scope, provider), ''));
    setApiKey('');
    toast('Chave salva removida deste navegador.');
  }

  function chooseFiles(event) {
    const selected = [...(event.target.files || [])];
    event.target.value = '';
    if (!selected.length) return;
    if (selected.some((file) => !file.type.startsWith('image/') && !file.type.startsWith('video/'))) {
      setError('Envie imagens ou vídeos. Outros formatos não são aceitos.');
      return;
    }
    if (selected.some((file) => file.size > MAX_FILE_BYTES)) {
      setError('Cada arquivo deve ter no máximo 30 MB.');
      return;
    }
    const keys = new Set(files.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    const added = selected.filter((file) => {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
    if (files.length + added.length > MAX_FILES) {
      setError(`Você pode usar até ${MAX_FILES} imagens e/ou vídeos como referência.`);
      return;
    }
    setError('');
    setFiles((current) => [...current, ...added]);
  }

  async function generate(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (rememberKey) setStorageWarning(writeCredential(credentialKey(scope, provider), apiKey));
      const attachments = await prepareAttachments(files);
      const result = await api.post('/portfolios/ai-build', {
        provider, model, apiKey, siteName: siteName.trim(), prompt: prompt.trim(), pageCount, referenceCount: files.length, attachments,
      });
      toast(`${result.portfolios.length} ${result.portfolios.length === 1 ? 'página criada' : 'páginas criadas'} com a IA.`);
      onCreated(result.portfolios);
    } catch (cause) {
      setError(cause.message || 'Não foi possível criar o site.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Construtor IA" onClose={() => { if (!busy) onClose(); }} wide>
      <form className="ai-site-builder" onSubmit={generate}>
        <p className="muted">Descreva seu negócio, escolha a IA e receba páginas editáveis no construtor de portfólio. O texto e as referências visuais são enviados ao provedor escolhido.</p>
        <div className="ai-site-grid">
          <label className="field"><span>Modelo de IA</span>
            <select className="input" value={provider} onChange={(event) => changeProvider(event.target.value)}>
              {Object.entries(PROVIDERS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Identificador do modelo</span>
            <input className="input" value={model} onChange={(event) => setModel(event.target.value)} required maxLength={100} />
          </label>
          <label className="field ai-site-full"><span>Token / chave de API</span>
            <input className="input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required minLength={16} maxLength={1000} autoComplete="new-password" />
            <small className="muted">A chave é enviada ao provedor escolhido para gerar o site e, se marcado abaixo, fica salva no armazenamento local deste navegador, por conta/loja e provedor.</small>
          </label>
          <div className="ai-site-full ai-site-credential-options">
            <label className="small"><input type="checkbox" checked={rememberKey} onChange={(event) => toggleRemember(event.target.checked)} /> Lembrar minhas chaves neste navegador</label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearSavedKey} disabled={!apiKey}>Apagar chave salva</button>
          </div>
          <p className="ai-site-security-note ai-site-full">A chave nunca é salva no servidor, mas o armazenamento local pode ser acessado por scripts executados neste site. Evite salvar em computadores compartilhados; você pode apagar a chave a qualquer momento.</p>
          {storageWarning && <p className="form-error ai-site-full" role="status">{storageWarning}</p>}
          <label className="field"><span>Nome do site</span>
            <input className="input" value={siteName} onChange={(event) => setSiteName(event.target.value)} maxLength={120} placeholder="Ex.: Studio Ana" />
          </label>
          <label className="field"><span>Quantidade de páginas (até 5)</span>
            <select className="input" value={pageCount} onChange={(event) => setPageCount(Number(event.target.value))}>
              {Array.from({ length: Math.min(5, Math.max(1, availablePages)) }, (_, index) => index + 1)
                .map((count) => <option key={count} value={count}>{count} {count === 1 ? 'página' : 'páginas'}</option>)}
            </select>
            <small className="muted">Escolha quantas páginas a IA vai criar. O limite disponível no seu plano é respeitado.</small>
          </label>
          <label className="field ai-site-full"><span>Como você quer seu site?</span>
            <textarea className="input" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={6} minLength={20} maxLength={4000} required
              placeholder="Conte o que sua empresa faz, quem atende, quais serviços devem aparecer e o estilo desejado. Não inclua senhas ou informações privadas." />
          </label>
          <div className="field ai-site-full">
            <span>Imagens e vídeos de referência (opcional)</span>
            <label className="ai-site-file-picker">
              <Icon name="camera" size={18} />
              <span>Adicionar arquivos</span>
              <small>{files.length} de {MAX_FILES}</small>
              <input type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple onChange={chooseFiles} disabled={files.length >= MAX_FILES} />
            </label>
            <small className="muted">Adicione até cinco imagens e/ou vídeos, com até 30 MB cada. Vídeos são analisados por até três quadros; o arquivo original não é publicado. Para exibir um vídeo no site, use um link público do YouTube ou Vimeo na descrição.</small>
            {files.length > 0 && (
              <div className="ai-site-file-list" aria-label="Arquivos de referência selecionados">
                {files.map((file, index) => (
                  <div className="ai-site-file-card" key={`${file.name}:${file.size}:${file.lastModified}`}>
                    <MediaPreview file={file} />
                    <div className="ai-site-file-info">
                      <strong title={file.name}>{file.name}</strong>
                      <span>{file.type.startsWith('video/') ? 'Vídeo · quadros enviados como referência' : 'Imagem de referência'} · {(file.size / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB</span>
                    </div>
                    <button className="icon-btn" type="button" aria-label={`Remover ${file.name}`} title="Remover arquivo" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} disabled={busy}>
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="banner banner-amber">
          <div><strong>Geração protegida</strong><span>O construtor cria páginas com componentes visuais permitidos. Não executa código ou bibliotecas externas gerados por prompt; webhooks devem ser configurados na área de API.</span></div>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="ai-site-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy || apiKey.length < 16 || prompt.trim().length < 20}>
            <Icon name="sparkles" size={17} /> {busy ? 'Criando seu site...' : 'Criar com IA'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
