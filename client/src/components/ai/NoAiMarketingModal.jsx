import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import Icon from '../Icon.jsx';
import Modal from '../Modal.jsx';
import { useToast } from '../Toast.jsx';
import { formatStoredPhone } from '../../lib/format.js';

const MAX_CONTACTS = 3000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/3gpp']);
const OPEN = ['running', 'paused'];
const CAMPAIGN_STATUS = { running: 'Em andamento', paused: 'Pausada', completed: 'Concluída', cancelled: 'Cancelada' };
const ITEM_STATUS = { pending: 'Aguardando', sending: 'Enviando', sent: 'Enviada', failed: 'Falhou', skipped: 'Não enviada' };

function formatTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function estimateDuration(seconds) {
  const mins = Math.ceil(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return `${hours}h${rest ? ` ${rest}min` : ''}`;
}

function encodeFile(file) {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  });
}

export default function NoAiMarketingModal({ data, onClose }) {
  const toast = useToast();
  const [campaigns, setCampaigns] = useState(null);
  const [instanceId, setInstanceId] = useState(String(data.instances[0]?.id || ''));
  const [selectedPhones, setSelectedPhones] = useState([]);
  const [query, setQuery] = useState('');
  const [intervalSeconds, setIntervalSeconds] = useState('30');
  const [message, setMessage] = useState('');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [media, setMedia] = useState(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const result = await api.get('/ai/marketing-campaigns');
      setCampaigns(result.campaigns);
      setLoadError('');
    } catch (err) { setLoadError(err.message); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const poll = setInterval(load, 3000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]);
  useEffect(() => () => {
    if (media?.previewUrl) URL.revokeObjectURL(media.previewUrl);
  }, [media?.previewUrl]);

  const filteredFolders = useMemo(() => data.folders.map((folder) => ({
    ...folder,
    filteredContacts: folder.contacts.filter((contact) => `${contact.name || ''} ${contact.phone}`.toLowerCase().includes(query.toLowerCase())),
  })).filter((folder) => folder.filteredContacts.length), [data.folders, query]);
  const selected = useMemo(() => new Set(selectedPhones), [selectedPhones]);
  const current = campaigns?.find((campaign) => OPEN.includes(campaign.status));
  const history = campaigns?.filter((campaign) => !OPEN.includes(campaign.status)) || [];
  const instance = data.instances.find((item) => String(item.id) === instanceId);
  const ready = Boolean(instance && selectedPhones.length && consentConfirmed && (message.trim() || media) && !busy);
  const estimatedAt = current && current.status === 'running'
    ? new Date(Math.max(now, new Date(current.estimatedEndAt).getTime()))
    : null;

  function toggleContacts(phones) {
    setError('');
    const unique = [...new Set(phones)];
    const allSelected = unique.length > 0 && unique.every((phone) => selected.has(phone));
    if (allSelected) {
      const remove = new Set(unique);
      setSelectedPhones((old) => old.filter((phone) => !remove.has(phone)));
      return;
    }
    const fresh = unique.filter((phone) => !selected.has(phone));
    if (selected.size + fresh.length > MAX_CONTACTS) {
      setError(`Cada campanha pode ter até ${MAX_CONTACTS} contatos. Remova alguns para selecionar mais.`);
      return;
    }
    setSelectedPhones((old) => [...old, ...fresh]);
  }

  async function chooseMedia(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!ALLOWED_TYPES.has(file.type)) {
      setError('Use uma imagem JPEG, PNG ou WebP, ou um vídeo MP4 ou 3GPP.');
      return;
    }
    if (file.size < 1 || file.size > MAX_FILE_BYTES) {
      setError('O arquivo deve ter até 100 MB.');
      return;
    }
    try {
      const base64 = await encodeFile(file);
      setMedia({ name: file.name, mimeType: file.type, base64, previewUrl: URL.createObjectURL(file) });
      setError('');
    } catch (err) {
      setError(`Não foi possível ler o arquivo: ${err.message}`);
    }
  }

  function removeMedia() {
    if (media?.previewUrl) URL.revokeObjectURL(media.previewUrl);
    setMedia(null);
  }

  async function startCampaign(event) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/ai/marketing-campaigns', {
        instanceId: Number(instanceId),
        contactPhones: selectedPhones,
        message: message.trim(),
        intervalSeconds: Number(intervalSeconds),
        consentConfirmed,
        media: media ? { name: media.name, mimeType: media.mimeType, base64: media.base64 } : null,
      });
      toast('Campanha iniciada. Você pode acompanhar o andamento aqui.');
      setSelectedPhones([]);
      setMessage('');
      setConsentConfirmed(false);
      removeMedia();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function controlCampaign(action) {
    if (!current) return;
    setActionBusy(true);
    setError('');
    try {
      await api.post(`/ai/marketing-campaigns/${current.id}/${action}`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionBusy(false);
    }
  }

  function cancelCampaign() {
    if (window.confirm('Cancelar esta campanha? As mensagens ainda não enviadas serão descartadas.')) controlCampaign('cancel');
  }

  return (
    <Modal wide title="Marketing sem IA" onClose={onClose} footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>}>
      <div className="noai-marketing">
        <p className="muted small">Envie uma mensagem escrita por você, sem agente ou provedor de IA. Use somente contatos que autorizaram receber suas comunicações.</p>
        {loadError && <p className="form-error" role="alert">{loadError} <button type="button" className="link-btn" onClick={load}>Tentar novamente</button></p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {!campaigns && !loadError && <p className="muted">Carregando campanhas...</p>}

        {campaigns && current && (
          <section className="noai-campaign-monitor" aria-label="Andamento da campanha">
            <div className="cmp-head">
              <span className={`cmp-status is-${current.status}`}>{CAMPAIGN_STATUS[current.status]}</span>
              <strong>{current.sent + current.failed + current.skipped} de {current.total} processadas</strong>
            </div>
            <p className="muted small">Instância: {current.instanceName} · Intervalo fixo: {current.intervalSeconds}s</p>
            <progress className="cmp-progress" max={current.total} value={current.sent + current.failed + current.skipped} />
            <div className="cmp-counts">
              <span>Enviadas: <strong>{current.sent}</strong></span>
              <span>Aguardando: <strong>{current.pending}</strong></span>
              <span>Falhas: <strong>{current.failed}</strong></span>
            </div>
            <p className="small">{current.status === 'running' ? 'Término estimado' : current.status === 'paused' ? 'Previsão ao retomar' : 'Finalizada'}: <strong>{current.finishedAt ? formatTime(current.finishedAt) : estimatedAt ? formatTime(estimatedAt) : formatTime(current.estimatedEndAt)}</strong></p>
            {current.lastError && <p className="form-error" role="alert">{current.lastError}</p>}
            <div className="cmp-controls">
              {current.status === 'paused'
                ? <button type="button" className="btn btn-primary btn-sm" onClick={() => controlCampaign('resume')} disabled={actionBusy}>Retomar</button>
                : <button type="button" className="btn btn-ghost btn-sm" onClick={() => controlCampaign('pause')} disabled={actionBusy}>Pausar</button>}
              <button type="button" className="btn btn-ghost btn-sm icon-btn-danger" onClick={cancelCampaign} disabled={actionBusy}>Cancelar</button>
            </div>
            {current.failed > 0 && (
              <details className="noai-failures" open>
                <summary>Ver contatos com falha ({current.failed})</summary>
                <ul className="cmp-items">
                  {current.items.filter((item) => item.status === 'failed').map((item) => (
                    <li key={item.id}><span className="cmp-dot is-failed" /><span><strong>{item.name || formatStoredPhone(item.phone)}</strong><small>{item.error}</small></span><span>{ITEM_STATUS[item.status]}</span></li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}

        {campaigns && !current && (
          <form className="noai-marketing-form" onSubmit={startCampaign}>
            <label className="field"><span>Número do WhatsApp</span>
              <select className="input" required value={instanceId} onChange={(event) => setInstanceId(event.target.value)}>
                <option value="">Selecione uma instância</option>
                {data.instances.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.provider === 'meta' ? 'API Meta' : 'QR Code'}</option>)}
              </select>
              {instance?.provider === 'meta' && <small className="muted">Na API oficial, mensagens fora da janela de atendimento de 24 horas podem exigir um modelo aprovado pela Meta.</small>}
              {!data.instances.length && <small className="form-error">Conecte um WhatsApp antes de criar a campanha.</small>}
            </label>

            <section className="noai-contact-picker">
              <div className="noai-section-head">
                <div><strong>Destinatários</strong><small className="muted">Selecione de 1 a {MAX_CONTACTS} contatos já cadastrados.</small></div>
                <strong>{selectedPhones.length}/{MAX_CONTACTS}</strong>
              </div>
              <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar contatos..." aria-label="Buscar contatos" />
              <div className="noai-contact-groups">
                {filteredFolders.map((folder) => {
                  const phones = folder.filteredContacts.map((contact) => contact.phone);
                  const allSelected = phones.length > 0 && phones.every((phone) => selected.has(phone));
                  return (
                    <fieldset className="noai-contact-group" key={folder.id}>
                      <legend>{folder.name} <small>({folder.filteredContacts.length})</small></legend>
                      <button type="button" className="link-btn" onClick={() => toggleContacts(phones)}>{allSelected ? 'Desmarcar lista' : 'Selecionar lista'}</button>
                      {folder.filteredContacts.slice(0, 100).map((contact) => (
                        <label className="noai-contact" key={`${folder.id}-${contact.phone}`}>
                          <input type="checkbox" checked={selected.has(contact.phone)} onChange={() => toggleContacts([contact.phone])} />
                          <span><strong>{contact.name || 'Sem nome'}</strong><small>{formatStoredPhone(contact.phone)}</small></span>
                        </label>
                      ))}
                      {folder.filteredContacts.length > 100 && <small className="muted">Refine a busca para ver mais contatos.</small>}
                    </fieldset>
                  );
                })}
                {!filteredFolders.length && <p className="muted small">Nenhum contato encontrado. Cadastre contatos ou ajuste a busca.</p>}
              </div>
            </section>

            <label className="field"><span>{media ? 'Legenda da mídia (opcional)' : 'Mensagem'}</span>
              <textarea className="input" rows="4" maxLength={media ? 1024 : 4096} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={media ? 'Escreva uma legenda para a foto ou vídeo...' : 'Escreva a mensagem que será enviada...'} />
              <small className="muted">{message.length}/{media ? 1024 : 4096} caracteres</small>
            </label>

            <div className="noai-media-upload">
              <label className="btn btn-ghost btn-sm">
                <Icon name="camera" size={16} /> {media ? 'Trocar foto ou vídeo' : 'Adicionar foto ou vídeo'}
                <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp" hidden onChange={chooseMedia} />
              </label>
              <small className="muted">JPEG, PNG, WebP, MP4 ou 3GPP · até 100 MB</small>
              {media && (
                <div className="noai-media-preview">
                  {media.mimeType.startsWith('video/')
                    ? <video src={media.previewUrl} controls preload="metadata" />
                    : <img src={media.previewUrl} alt="Prévia da imagem" />}
                  <span>{media.name}</span>
                  <button type="button" className="link-btn" onClick={removeMedia}>Remover mídia</button>
                </div>
              )}
            </div>

            <label className="field"><span>Intervalo fixo entre envios</span>
              <select className="input" value={intervalSeconds} onChange={(event) => setIntervalSeconds(event.target.value)}>
                {[20, 30, 60, 120].map((seconds) => <option key={seconds} value={seconds}>{seconds} segundos</option>)}
              </select>
              <small className="muted">{selectedPhones.length ? `Duração aproximada: ${estimateDuration(selectedPhones.length * Number(intervalSeconds))}. As mensagens são enviadas em sequência, sem variação aleatória.` : 'Selecione destinatários para calcular a duração.'}</small>
            </label>

            <label className="noai-consent">
              <input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} />
              <span>Confirmo que todos os contatos selecionados autorizaram receber mensagens de marketing e que vou respeitar pedidos para não receber novas mensagens.</span>
            </label>

            <button type="submit" className="btn btn-primary" disabled={!ready}>
              <Icon name="send" size={16} /> {busy ? 'Iniciando...' : `Iniciar campanha${selectedPhones.length ? ` (${selectedPhones.length})` : ''}`}
            </button>
          </form>
        )}

        {campaigns && history.length > 0 && (
          <details className="noai-history">
            <summary>Campanhas recentes</summary>
            {history.map((campaign) => (
              <details className="noai-history-entry" key={campaign.id}>
                <summary className="noai-history-item">
                  <span className={`cmp-status is-${campaign.status}`}>{CAMPAIGN_STATUS[campaign.status]}</span>
                  <span>{campaign.sent} enviadas · {campaign.failed} falhas · {campaign.total} contatos</span>
                  <time>{formatTime(campaign.finishedAt || campaign.createdAt)}</time>
                </summary>
                {campaign.failed > 0 && <ul className="cmp-items">
                  {campaign.items.filter((item) => item.status === 'failed').map((item) => (
                    <li key={item.id}><span className="cmp-dot is-failed" /><span><strong>{item.name || formatStoredPhone(item.phone)}</strong><small>{item.error}</small></span><span>{ITEM_STATUS[item.status]}</span></li>
                  ))}
                </ul>}
                {!campaign.failed && <p className="muted small">Sem falhas registradas.</p>}
              </details>
            ))}
          </details>
        )}
      </div>
    </Modal>
  );
}
