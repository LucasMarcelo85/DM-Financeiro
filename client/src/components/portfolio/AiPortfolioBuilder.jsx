import { useState } from 'react';
import { api, getActiveStore, isShopMode, shopSlug } from '../../api.js';
import Icon from '../Icon.jsx';
import Modal from '../Modal.jsx';
import { useToast } from '../Toast.jsx';

const PROVIDERS = {
  gemini: { label: 'Google Gemini', model: 'gemini-2.0-flash' },
  openai: { label: 'OpenAI', model: 'gpt-4o-mini' },
  claude: { label: 'Anthropic Claude', model: 'claude-3-5-haiku-latest' },
};
const MAX_FILES = 4;
const MAX_FILE_BYTES = 30 * 1024 * 1024;
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
  const timer = setTimeout(() => reject(new Error('Não foi possível ler a mídia enviada. Tente outro arquivo.')), 12000);
  target.addEventListener(eventName, () => { clearTimeout(timer); resolve(); }, { once: true });
  target.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Não foi possível ler a mídia enviada. Tente outro arquivo.')); }, { once: true });
});

function jpegAttachment(canvas, name) {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  return { name, mime: 'image/jpeg', base64: dataUrl.split(',')[1] };
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
  if (attachments.length > MAX_FILES) throw new Error('Use até quatro imagens ou quadros de vídeo no total.');
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
    if (selected.length > MAX_FILES) { setError('Escolha até quatro arquivos.'); return; }
    if (selected.some((file) => !file.type.startsWith('image/') && !file.type.startsWith('video/'))) {
      setError('Envie imagens ou vídeos. Outros formatos não são aceitos.');
      return;
    }
    if (selected.some((file) => file.size > MAX_FILE_BYTES)) {
      setError('Cada arquivo deve ter no máximo 30 MB.');
      return;
    }
    if (selected.filter((file) => file.type.startsWith('video/')).length > 1) {
      setError('Envie no máximo um vídeo por geração.');
      return;
    }
    setError('');
    setFiles(selected);
  }

  async function generate(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (rememberKey) setStorageWarning(writeCredential(credentialKey(scope, provider), apiKey));
      const attachments = await prepareAttachments(files);
      const result = await api.post('/portfolios/ai-build', {
        provider, model, apiKey, siteName: siteName.trim(), prompt: prompt.trim(), pageCount, attachments,
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
          <label className="field"><span>Quantidade de páginas</span>
            <select className="input" value={pageCount} onChange={(event) => setPageCount(Number(event.target.value))}>
              {Array.from({ length: Math.min(5, Math.max(1, availablePages)) }, (_, index) => index + 1)
                .map((count) => <option key={count} value={count}>{count} {count === 1 ? 'página' : 'páginas'}</option>)}
            </select>
          </label>
          <label className="field ai-site-full"><span>Como você quer seu site?</span>
            <textarea className="input" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={6} minLength={20} maxLength={4000} required
              placeholder="Conte o que sua empresa faz, quem atende, quais serviços devem aparecer e o estilo desejado. Não inclua senhas ou informações privadas." />
          </label>
          <label className="field ai-site-full"><span>Fotos ou vídeo de referência (opcional)</span>
            <input className="input" type="file" accept="image/*,video/mp4,video/webm" multiple onChange={chooseFiles} />
            <small className="muted">Fotos são redimensionadas; vídeos são analisados por até três quadros. O vídeo original não é publicado. Para exibi-lo no site, use um link público de YouTube ou Vimeo na descrição.</small>
            {files.length > 0 && <small>{files.map((file) => file.name).join(', ')}</small>}
          </label>
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
