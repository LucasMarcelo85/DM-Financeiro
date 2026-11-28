import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FaInstagram, FaWhatsapp } from 'react-icons/fa6';
import { api } from '../api.js';
import ContactsPanel from '../components/ai/ContactsPanel.jsx';
import ActionsModal from '../components/ai/ActionsModal.jsx';
import CampaignModal from '../components/ai/CampaignModal.jsx';
import NoAiMarketingModal from '../components/ai/NoAiMarketingModal.jsx';
import PromptsPanel from '../components/ai/PromptsPanel.jsx';
import HelpNote from '../components/HelpNote.jsx';
import Icon from '../components/Icon.jsx';
import StoreBar from '../components/StoreBar.jsx';
import WhatsAppManagerModal from '../components/WhatsAppManagerModal.jsx';
import { useToast } from '../components/Toast.jsx';
import { formatStoredPhone } from '../lib/format.js';

const fmtDate = (timestamp) => new Date(timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const formatCredits = (micros) => (Number(micros || 0) / 1_000_000).toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 4, maximumFractionDigits: 6,
});
const formatDuration = (seconds) => `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
const TOP_UPS = [[500, 'R$ 5'], [1000, 'R$ 10'], [2000, 'R$ 20'], [5000, 'R$ 50']];
const typedPhone = (value) => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.length >= 12 && digits.length <= 15 ? digits : '';
};
const MAX_CAMPAIGN_CONTACTS = 3000;

function AgentEditor({ initial, data, onClose, onSaved, onConnectInstagram, instagramConnecting }) {
  const toast = useToast();
  const editing = Boolean(initial?.id);
  const [form, setForm] = useState(() => ({
    name: initial?.name || '',
    mode: initial?.mode || 'atendimento',
    prompt: initial?.prompt || data.templates.atendimento,
    monthlyLimit: initial?.monthlyLimit || 100,
    instanceId: initial?.instanceId || '',
    instagramAccountId: initial?.instagramAccountId ? String(initial.instagramAccountId) : '',
    respondInstagramDirect: initial?.respondInstagramDirect || false,
    respondInstagramComments: initial?.respondInstagramComments || false,
    contactIds: initial?.contactIds || [],
    active: initial?.active ?? true,
    dataAccess: { orders: true, products: false, billing: false, ...(initial?.dataAccess || {}) },
    schedule: { enabled: false, days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00', from: '', until: '', ...(initial?.schedule || {}) },
  }));
  const [selectedChannels, setSelectedChannels] = useState(() => ({
    whatsapp: Boolean(initial?.instanceId),
    instagram: Boolean(initial?.instagramAccountId),
  }));
  const toggleChannel = (channel, enabled) => {
    setSelectedChannels((current) => ({ ...current, [channel]: enabled }));
    if (!enabled) {
      setForm((current) => channel === 'whatsapp'
        ? { ...current, instanceId: '' }
        : { ...current, instagramAccountId: '', respondInstagramDirect: false, respondInstagramComments: false });
    }
  };
  const setSchedule = (key, value) => setForm((current) => ({ ...current, schedule: { ...current.schedule, [key]: value } }));
  const toggleDay = (day) => setSchedule('days', form.schedule.days.includes(day) ? form.schedule.days.filter((item) => item !== day) : [...form.schedule.days, day]);
  const [saving, setSaving] = useState(false);
  const contactFolders = data.folders.filter((item) => !item.system || item.contacts.length > 0);
  const [folderId, setFolderId] = useState(contactFolders[0]?.id || '');
  const [manualNumber, setManualNumber] = useState('');
  const selectedContacts = useMemo(() => new Set(form.contactIds), [form.contactIds]);
  const folder = contactFolders.find((item) => item.id === folderId) || contactFolders[0];
  const namesByPhone = useMemo(() => {
    const map = new Map();
    for (const item of data.folders) for (const contact of item.contacts) if (!map.has(contact.phone)) map.set(contact.phone, contact.name);
    return map;
  }, [data.folders]);
  const promptOptions = useMemo(() => [
    ...data.prompts.filter((item) => item.mode === form.mode).map((item) => ({ ...item, key: `u${item.id}`, group: 'Meus prompts' })),
    ...data.builtinPrompts.filter((item) => item.mode === form.mode).map((item) => ({ ...item, key: item.id, group: 'Modelos prontos' })),
  ], [data.prompts, data.builtinPrompts, form.mode]);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const toggleDataAccess = (key) => (event) => setForm((current) => ({
    ...current, dataAccess: { ...current.dataAccess, [key]: event.target.checked },
  }));
  const usePrompt = (key) => {
    const chosen = promptOptions.find((item) => item.key === key);
    if (!chosen) return;
    if (form.prompt.trim() && ![...data.builtinPrompts, ...data.prompts].some((item) => item.content === form.prompt) && !window.confirm('Substituir o prompt atual pelo prompt escolhido?')) return;
    setForm((current) => ({ ...current, prompt: chosen.content }));
  };
  const addPhones = (phones) => {
    const fresh = phones.filter((phone) => !selectedContacts.has(phone));
    if (selectedContacts.size + fresh.length > MAX_CAMPAIGN_CONTACTS) {
      toast(`Cada agente de marketing pode ter até ${MAX_CAMPAIGN_CONTACTS.toLocaleString('pt-BR')} contatos selecionados.`, 'error');
      return;
    }
    setForm((current) => ({ ...current, contactIds: [...current.contactIds, ...fresh] }));
  };
  const toggleContact = (phone) => {
    if (selectedContacts.has(phone)) setForm((current) => ({ ...current, contactIds: current.contactIds.filter((item) => item !== phone) }));
    else addPhones([phone]);
  };
  const folderAllSelected = Boolean(folder?.contacts.length) && folder.contacts.every((contact) => selectedContacts.has(contact.phone));
  const toggleFolder = () => {
    if (!folder) return;
    if (folderAllSelected) {
      const phones = new Set(folder.contacts.map((contact) => contact.phone));
      setForm((current) => ({ ...current, contactIds: current.contactIds.filter((item) => !phones.has(item)) }));
    } else addPhones(folder.contacts.map((contact) => contact.phone));
  };
  const allFolderContacts = [...new Set(contactFolders.flatMap((item) => item.contacts.map((contact) => contact.phone)))];
  const allContactsSelected = allFolderContacts.length > 0 && allFolderContacts.every((phone) => selectedContacts.has(phone));
  const toggleAllContacts = () => {
    if (allContactsSelected) {
      const phones = new Set(allFolderContacts);
      setForm((current) => ({ ...current, contactIds: current.contactIds.filter((phone) => !phones.has(phone)) }));
    } else addPhones(allFolderContacts);
  };
  const addManual = () => {
    const phone = typedPhone(manualNumber);
    if (!phone) {
      toast('Informe um telefone válido com DDD, por exemplo (85) 99999-9999.', 'error');
      return;
    }
    addPhones([phone]);
    setManualNumber('');
  };
  async function submit(event) {
    event.preventDefault();
    if (form.mode === 'atendimento') {
      if (!selectedChannels.whatsapp && !selectedChannels.instagram) {
        toast('Escolha WhatsApp, Instagram ou os dois canais.', 'error');
        return;
      }
      if (selectedChannels.whatsapp && !form.instanceId) {
        toast('Selecione uma conexão de WhatsApp.', 'error');
        return;
      }
      if (selectedChannels.instagram && !form.instagramAccountId) {
        toast('Conecte e selecione uma conta profissional do Instagram.', 'error');
        return;
      }
      if (selectedChannels.instagram && !form.respondInstagramDirect && !form.respondInstagramComments) {
        toast('Escolha se o agente responderá ao Direct, aos comentários ou a ambos.', 'error');
        return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        instanceId: form.mode === 'atendimento' && !selectedChannels.whatsapp ? null : form.instanceId || null,
        instagramAccountId: form.mode === 'atendimento' && !selectedChannels.instagram ? null : form.instagramAccountId ? Number(form.instagramAccountId) : null,
        respondInstagramDirect: form.mode === 'atendimento' && selectedChannels.instagram && form.respondInstagramDirect,
        respondInstagramComments: form.mode === 'atendimento' && selectedChannels.instagram && form.respondInstagramComments,
        monthlyLimit: Number(form.monthlyLimit),
      };
      if (editing) await api.put(`/ai/agents/${initial.id}`, payload);
      else await api.post('/ai/agents', payload);
      toast(editing ? 'Agente atualizado.' : 'Agente criado.');
      await onSaved();
      onClose();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ai-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="ai-editor" role="dialog" aria-modal="true" aria-labelledby="ai-editor-title">
        <div className="ai-editor-head">
          <div><h2 id="ai-editor-title">{editing ? 'Editar agente' : 'Criar agente da Dm Soluções'}</h2><p className="muted small">A Dm Soluções cuida da inteligência e dos créditos. Escolha WhatsApp, Instagram ou os dois canais para este atendimento.</p></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar"><Icon name="x" /></button>
        </div>
        <form className="ai-form" onSubmit={submit}>
          <label className="field"><span>Nome do agente</span><input className="input" value={form.name} onChange={set('name')} required minLength={2} maxLength={80} placeholder="Ex.: Atendimento da loja" /></label>
          {form.mode === 'atendimento' ? (
            <>
              <fieldset className="ai-schedule ai-channel-selection">
                <legend>Canais de atendimento</legend>
                <small>Ative um canal ou os dois. O agente responderá somente nos canais selecionados.</small>
                <div className="ai-channel-options">
                  <label className={`ai-channel-option ${selectedChannels.whatsapp ? 'is-selected' : ''}`}>
                    <input type="checkbox" checked={selectedChannels.whatsapp} onChange={(event) => toggleChannel('whatsapp', event.target.checked)} />
                    <FaWhatsapp className="ai-channel-icon whatsapp" size={24} />
                    <span><strong>WhatsApp</strong><small>Responder mensagens</small></span>
                  </label>
                  <label className={`ai-channel-option ${selectedChannels.instagram ? 'is-selected' : ''}`}>
                    <input type="checkbox" checked={selectedChannels.instagram} onChange={(event) => toggleChannel('instagram', event.target.checked)} />
                    <FaInstagram className="ai-channel-icon instagram" size={24} />
                    <span><strong>Instagram</strong><small>Direct e comentários</small></span>
                  </label>
                </div>
                {selectedChannels.whatsapp && (data.instances.length ? (
                  <label className="field"><span>Conexão do WhatsApp</span>
                    <select className="input" value={form.instanceId} onChange={set('instanceId')} required>
                      <option value="">Selecione uma conexão</option>
                      {data.instances.map((instance) => <option key={instance.id} value={instance.id}>{instance.displayName} · {instance.provider === 'meta' ? 'API Meta' : 'QR Code'}</option>)}
                    </select>
                  </label>
                ) : <p className="muted small">Nenhum WhatsApp conectado. Conecte um número antes de selecionar este canal.</p>)}
                {selectedChannels.instagram && (data.instagramAccounts.length ? (
                  <>
                    <label className="field"><span>Conta profissional do Instagram</span>
                      <select className="input" value={form.instagramAccountId} onChange={(event) => setForm((current) => ({
                        ...current,
                        instagramAccountId: event.target.value,
                        respondInstagramDirect: false,
                        respondInstagramComments: false,
                      }))} required>
                        <option value="">Selecione uma conta conectada</option>
                        {data.instagramAccounts.map((account) => <option key={account.id} value={account.id}>@{account.username}</option>)}
                      </select>
                    </label>
                    {(() => {
                      const account = data.instagramAccounts.find((item) => String(item.id) === form.instagramAccountId);
                      return account && <>
                        <label className="ai-checkbox"><input type="checkbox" checked={form.respondInstagramDirect} disabled={!account.canReceiveMessages} onChange={(event) => setForm((current) => ({ ...current, respondInstagramDirect: event.target.checked }))} /> Responder mensagens do Direct</label>
                        <label className="ai-checkbox"><input type="checkbox" checked={form.respondInstagramComments} disabled={!account.canReplyToComments} onChange={(event) => setForm((current) => ({ ...current, respondInstagramComments: event.target.checked }))} /> Responder comentários nas publicações</label>
                        {(!account.canReceiveMessages || !account.canReplyToComments) && <small className="form-error">Algumas permissões não foram concedidas. Reconecte a conta para autorizar os canais desativados.</small>}
                      </>;
                    })()}
                  </>
                ) : (
                  <div className="ai-channel-connect">
                    <p className="muted small">Nenhuma conta profissional conectada nesta loja.</p>
                    {data.instagramConfigured
                      ? <button type="button" className="btn btn-ghost btn-sm" onClick={onConnectInstagram} disabled={instagramConnecting}>{instagramConnecting ? 'Conectando...' : 'Conectar Instagram'}</button>
                      : <small className="muted">A conexão não está disponível. Fale com o suporte.</small>}
                  </div>
                ))}
                <small>O agente responde quando alguém envia uma mensagem ou comenta. A Meta não permite iniciar Direct automaticamente para novos seguidores.</small>
              </fieldset>
              <fieldset className="ai-schedule">
                <legend>Dados do sistema que este agente pode consultar</legend>
                <small>Os dados são limitados ao cliente identificado pelo telefone e à loja selecionada. Desative o que não for necessário.</small>
                <label className="ai-checkbox"><input type="checkbox" checked={form.dataAccess.orders} onChange={toggleDataAccess('orders')} /> Pedidos, itens e status de pagamento</label>
                <label className="ai-checkbox"><input type="checkbox" checked={form.dataAccess.products} onChange={toggleDataAccess('products')} /> Produtos ativos, preços e estoque da loja</label>
                <label className="ai-checkbox"><input type="checkbox" checked={form.dataAccess.billing} onChange={toggleDataAccess('billing')} /> Cobranças e pagamentos confirmados</label>
                <small>Pix enviado manualmente ou comprovante recebido não comprova pagamento. A IA só informa como pago o que o sistema/provider confirmou.</small>
              </fieldset>
            </>
          ) : (
            <>
              <label className="field"><span>Instância para envio</span>
                <select className="input" value={form.instanceId} onChange={set('instanceId')} required>
                  <option value="">Selecione uma instância WhatsApp</option>
                  {data.instances.map((instance) => <option key={instance.id} value={instance.id}>{instance.displayName} · {instance.provider === 'meta' ? 'API Meta' : 'QR Code'}</option>)}
                </select>
              </label>
              <fieldset className="ai-contact-select">
                <legend>Contatos da campanha <small>({selectedContacts.size}/{MAX_CAMPAIGN_CONTACTS.toLocaleString('pt-BR')} selecionados)</small></legend>
                <button type="button" className="btn btn-ghost btn-sm" onClick={toggleAllContacts} disabled={!allFolderContacts.length}>
                  {allContactsSelected ? 'Desmarcar todos os contatos' : 'Selecionar todos os contatos das pastas'}
                </button>
                {!allFolderContacts.length && <p className="muted small">Nenhum contato disponível. Na aba Contatos, crie uma pasta e importe os contatos antes de selecioná-los aqui.</p>}
                <div className="ai-folder-picker">
                  <select className="input" value={folder?.id || ''} onChange={(event) => setFolderId(event.target.value)} aria-label="Pasta de contatos">
                    {contactFolders.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.contacts.length})</option>)}
                  </select>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={toggleFolder} disabled={!folder?.contacts.length}>{folderAllSelected ? 'Desmarcar a pasta' : 'Selecionar a pasta toda'}</button>
                </div>
                <div className="ai-contact-options">
                  {folder?.contacts.map((contact) => (
                    <label className="ai-contact-option" key={contact.id}>
                      <input type="checkbox" checked={selectedContacts.has(contact.phone)} onChange={() => toggleContact(contact.phone)} />
                      <span><strong>{contact.name}</strong><small>{formatStoredPhone(contact.phone)}</small>                      {contact.labels?.length > 0 && <span className="ai-contact-labels">{contact.labels.map((label) => <small key={label}>{label}</small>)}</span>}</span>
                    </label>
                  ))}
                  {!folder?.contacts.length && <p className="muted small">Esta pasta está vazia. Adicione números na aba Contatos ou digite um número abaixo.</p>}
                </div>
                <div className="ai-manual-number">
                  <input className="input" value={manualNumber} onChange={(event) => setManualNumber(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addManual(); } }} placeholder="Adicionar número agora: (85) 99999-9999" inputMode="tel" aria-label="Adicionar número" />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addManual}><Icon name="plus" size={16} /> Adicionar</button>
                </div>
                {form.contactIds.length > 0 && (
                  <div className="ai-selected-chips" aria-label="Contatos selecionados">
                    {form.contactIds.map((phone) => (
                      <span className="ai-chip" key={phone}>{namesByPhone.get(phone) || formatStoredPhone(phone)}
                        <button type="button" onClick={() => toggleContact(phone)} aria-label={`Remover ${phone}`}><Icon name="x" size={12} /></button>
                      </span>
                    ))}
                  </div>
                )}
              </fieldset>
            </>
          )}
          <label className="field"><span>Limite mensal de respostas IA</span>
            <input className="input" type="number" min="1" max="100000" value={form.monthlyLimit} onChange={set('monthlyLimit')} required />
            <small>Controla quantas respostas geradas pela IA podem ser feitas no mês. O limite não controla os preços cobrados diretamente pelo provedor.</small>
          </label>
          <label className="field"><span>Prompt do agente</span>
            <select className="input" value="" onChange={(event) => usePrompt(event.target.value)} aria-label="Escolher um prompt salvo ou modelo">
              <option value="">Carregar um prompt salvo ou modelo pronto…</option>
              {['Meus prompts', 'Modelos prontos'].map((group) => {
                const items = promptOptions.filter((item) => item.group === group);
                return items.length ? <optgroup key={group} label={group}>{items.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</optgroup> : null;
              })}
            </select>
            <textarea className="input ai-prompt ai-prompt-tall" value={form.prompt} onChange={set('prompt')} minLength={20} maxLength={12000} required />
            <small>Edite livremente. Crie e organize seus prompts na aba Prompts. No WhatsApp, pedidos do telefone entram como contexto privado. O agente também pode analisar imagens e transcrever áudios enviados pelos clientes.</small>
          </label>
          <fieldset className="ai-schedule">
            <legend>Horário de funcionamento</legend>
            <label className="ai-checkbox"><input type="checkbox" checked={form.schedule.enabled} onChange={(event) => setSchedule('enabled', event.target.checked)} /> Limitar o funcionamento a dias e horários (horário de Brasília)</label>
            {form.schedule.enabled ? (
              <>
                <div className="ai-days">
                  {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((label, day) => (
                    <button type="button" key={day} className={form.schedule.days.includes(day) ? 'is-on' : ''} aria-pressed={form.schedule.days.includes(day)} onClick={() => toggleDay(day)}>{label}</button>
                  ))}
                </div>
                <div className="form-row">
                  <label className="field"><span>Das</span><input className="input" type="time" value={form.schedule.start} onChange={(event) => setSchedule('start', event.target.value)} required /></label>
                  <label className="field"><span>Até</span><input className="input" type="time" value={form.schedule.end} onChange={(event) => setSchedule('end', event.target.value)} required /></label>
                </div>
                <div className="form-row">
                  <label className="field"><span>Válido a partir de (opcional)</span><input className="input" type="datetime-local" value={form.schedule.from} onChange={(event) => setSchedule('from', event.target.value)} /></label>
                  <label className="field"><span>Válido até (opcional)</span><input className="input" type="datetime-local" value={form.schedule.until} onChange={(event) => setSchedule('until', event.target.value)} /></label>
                </div>
                <small>Fora do horário o agente não responde (as mensagens ficam salvas) nem envia campanhas. Se o horário final for menor que o inicial (ex.: 22:00 às 06:00), a janela atravessa a meia-noite.</small>
              </>
            ) : <small>Sem limite: o agente funciona 24 horas, todos os dias.</small>}
          </fieldset>
          {editing && <label className="ai-checkbox"><input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} /> Agente ativo</label>}
          <div className="ai-editor-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
            <button className="btn btn-primary" disabled={saving}>{saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Criar agente'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ChatPanel({ conversation, onClose, onChanged }) {
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [note, setNote] = useState(conversation?.note || '');
  const [labelsText, setLabelsText] = useState((conversation?.labels || []).join(', '));
  const [sending, setSending] = useState(false);
  const orphan = conversation?.agentDeleted;
  const interrupted = conversation?.status === 'interrupted';
  const labelsKey = (conversation?.labels || []).join('\u0000');
  useEffect(() => {
    setNote(conversation?.note || '');
    setLabelsText(labelsKey.replaceAll('\u0000', ', '));
  }, [conversation?.id, conversation?.note, labelsKey]);
  async function control(action) {
    try {
      if (action === 'delete') {
        if (!window.confirm('Apagar esta conversa e todas as mensagens? Isso não pode ser desfeito.')) return;
        await api.del(`/ai/conversations/${conversation.id}`);
        onClose();
      } else await api.post(`/ai/conversations/${conversation.id}/${action}`);
      await onChanged();
    } catch (error) { toast(error.message, 'error'); }
  }
  const load = useCallback(async () => {
    if (!conversation) return;
    try {
      const result = await api.get(`/ai/conversations/${conversation.id}/messages`);
      setMessages(result.messages);
    } catch (error) { toast(error.message, 'error'); }
  }, [conversation?.id, toast]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [load]);
  async function send(event) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setSending(true);
    try {
      await api.post(`/ai/conversations/${conversation.id}/send`, { text: value });
      setText('');
      await load();
      await onChanged();
    } catch (error) { toast(error.message, 'error'); }
    finally { setSending(false); }
  }
  async function saveNote() {
    try {
      await api.put(`/ai/conversations/${conversation.id}/note`, { note });
      toast('Anotação salva.');
      await onChanged();
    } catch (error) { toast(error.message, 'error'); }
  }
  async function saveLabels() {
    try {
      const labels = labelsText.split(',').map((label) => label.trim()).filter(Boolean);
      const result = await api.put(`/ai/conversations/${conversation.id}/labels`, { labels });
      setLabelsText(result.labels.join(', '));
      toast('Etiquetas atualizadas.');
      await onChanged();
    } catch (error) { toast(error.message, 'error'); }
  }
  if (!conversation) return <div className="ai-chat-empty"><Icon name="chat" size={28} /><p>Selecione uma conversa para visualizar as mensagens em tempo real.</p></div>;
  const roleLabel = { user: 'Cliente', human: 'Atendente', error: 'Aviso', action: 'Função' };
  const contactLabel = conversation.channel?.startsWith('instagram_')
    ? conversation.name || 'Contato do Instagram'
    : conversation.name || formatStoredPhone(conversation.phone);
  const channelLabel = conversation.channel === 'instagram_direct' ? 'Instagram · Direct' : conversation.channel === 'instagram_comment' ? 'Instagram · Comentário' : 'WhatsApp';
  return (
    <section className="ai-chat">
      <header className="ai-chat-head">
        <button type="button" className="icon-btn ai-chat-back" onClick={onClose} aria-label="Voltar às conversas"><Icon name="left" /></button>
        <div><strong>{contactLabel}</strong><small>{channelLabel} · {conversation.agentName}{orphan ? ' (agente excluído)' : ''}</small></div>
        <div className="btn-group ai-chat-tools">
          {!orphan && (interrupted
            ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => control('resume')}>Retomar agente</button>
            : <button type="button" className="btn btn-ghost btn-sm" onClick={() => control('interrupt')}>Interromper agente</button>)}
          <button type="button" className="btn btn-ghost btn-sm icon-btn-danger" onClick={() => control('delete')}><Icon name="trash" size={16} /> Apagar</button>
        </div>
      </header>
      {interrupted && <div className="ai-interrupted-note">Conversa interrompida: o agente não responde automaticamente até ser retomado.</div>}
      <div className="ai-chat-context">
        <label className="field"><span>Etiquetas <small>(separe por vírgula)</small></span><input className="input" value={labelsText} onChange={(event) => setLabelsText(event.target.value)} maxLength={1200} disabled={orphan} placeholder="VIP, retorno, aguardando pagamento" /></label>
        {!orphan && <button type="button" className="btn btn-ghost btn-sm" onClick={saveLabels}>Salvar etiquetas</button>}
        <label className="field"><span>Bloco de anotações interno</span><textarea className="input" rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={20000} disabled={orphan} placeholder="Anote informações importantes desta conversa..." /></label>
        {!orphan && <button type="button" className="btn btn-ghost btn-sm" onClick={saveNote}>Salvar anotação</button>}
      </div>
      <div className="ai-chat-messages">
        {messages.map((message) => (
          <article key={message.id} className={`ai-bubble ${message.role === 'user' ? 'is-inbound' : message.role === 'human' ? 'is-human' : message.role === 'error' ? 'is-error' : message.role === 'action' ? 'is-action' : 'is-ai'}`}>
            <p>{message.content}</p><small>{roleLabel[message.role] || 'Dm Soluções'} · {fmtDate(message.createdAt)}</small>
          </article>
        ))}
        {!messages.length && <p className="muted">Ainda não há mensagens nesta conversa.</p>}
      </div>
      {orphan ? <p className="ai-interrupted-note">O agente desta conversa foi excluído. O histórico foi mantido apenas para consulta.</p> : (
        <form className="ai-chat-send" onSubmit={send}>
          <input className="input" value={text} onChange={(event) => setText(event.target.value)} maxLength={6000} placeholder="Responder manualmente (interrompe o agente)..." aria-label="Mensagem" />
          <button className="btn btn-primary" disabled={sending || !text.trim()}><Icon name="send" size={17} /> Enviar</button>
        </form>
      )}
    </section>
  );
}

export default function AiService() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const returnQuery = searchParams.toString();
  const [data, setData] = useState(null);
  const [credits, setCredits] = useState(null);
  const [creditError, setCreditError] = useState('');
  const [topUpAmount, setTopUpAmount] = useState(1000);
  const [topUpBusy, setTopUpBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('agentes');
  const [editor, setEditor] = useState(null);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [conversationAgent, setConversationAgent] = useState('');
  const [conversationOrder, setConversationOrder] = useState('recent');
  const [conversationSearch, setConversationSearch] = useState('');
  const [campaignAgent, setCampaignAgent] = useState(null);
  const [testing, setTesting] = useState(null);
  const [actionsAgent, setActionsAgent] = useState(null);
  const [noAiMarketingOpen, setNoAiMarketingOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [instagramBusy, setInstagramBusy] = useState(false);
  const [instagramDisconnecting, setInstagramDisconnecting] = useState(null);
  const [instagramConnectedNotice, setInstagramConnectedNotice] = useState(false);
  const confirmedReturn = useRef('');

  const load = useCallback(async () => {
    try {
      const result = await api.get('/ai');
      setData(result);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);
  const loadCredits = useCallback(async () => {
    try {
      setCredits(await api.get('/ai/credits'));
      setCreditError('');
    } catch (err) {
      setCreditError(err.message);
    }
  }, []);
  const loadConversations = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (conversationAgent) params.set('agentId', conversationAgent);
      if (conversationOrder === 'oldest') params.set('order', conversationOrder);
      const query = params.toString();
      const result = await api.get(`/ai/conversations${query ? `?${query}` : ''}`);
      setConversations(result.conversations);
      if (selectedConversation) {
        const fresh = result.conversations.find((item) => item.id === selectedConversation.id);
        if (fresh) setSelectedConversation(fresh);
      }
    } catch (err) { setError(err.message); }
  }, [conversationAgent, conversationOrder, selectedConversation?.id]);

  useEffect(() => { load(); loadCredits(); }, [load, loadCredits]);
  useEffect(() => {
    const params = new URLSearchParams(returnQuery);
    const orderNsu = params.get('order_nsu') || params.get('credit_order_nsu');
    const transactionNsu = params.get('transaction_nsu');
    const slug = params.get('slug');
    if (!orderNsu || !transactionNsu || !slug || confirmedReturn.current === orderNsu) return;
    confirmedReturn.current = orderNsu;
    api.post('/ai/credits/confirm', {
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      slug,
      receipt_url: params.get('receipt_url'),
    }).then((result) => {
      setCredits(result.credits);
      setCreditError('');
      toast('Pagamento confirmado. Seus créditos já estão disponíveis.');
      params.delete('order_nsu');
      params.delete('credit_order_nsu');
      params.delete('transaction_nsu');
      params.delete('slug');
      params.delete('receipt_url');
      setSearchParams(params, { replace: true });
    }).catch((err) => {
      confirmedReturn.current = '';
      toast(err.message, 'error');
    });
  }, [returnQuery, setSearchParams, toast]);
  useEffect(() => {
    const params = new URLSearchParams(returnQuery);
    const status = params.get('instagram_status');
    if (!status) return;
    toast(status === 'connected' ? 'Conta profissional do Instagram conectada.' : status === 'expired' ? 'A autorização do Instagram expirou. Tente conectar novamente.' : 'Não foi possível conectar o Instagram. Confira as permissões e tente novamente.', status === 'connected' ? 'ok' : 'error');
    params.delete('instagram_status');
    setSearchParams(params, { replace: true });
    if (status === 'connected') {
      setInstagramConnectedNotice(true);
      load();
    }
  }, [returnQuery, setSearchParams, toast, load]);
  useEffect(() => {
    if (tab !== 'conversas') return undefined;
    loadConversations();
    const timer = setInterval(loadConversations, 5000);
    return () => clearInterval(timer);
  }, [tab, loadConversations]);

  async function refreshUsage() {
    try {
      await api.get('/ai/usage');
      await load();
      await loadCredits();
      toast('Uso atualizado.');
    } catch (err) { toast(err.message, 'error'); }
  }
  async function rechargeCredits() {
    setTopUpBusy(true);
    try {
      const { url } = await api.post('/ai/credits/checkout', { amountCents: topUpAmount });
      window.location.assign(url);
    } catch (err) {
      toast(err.message, 'error');
      setTopUpBusy(false);
    }
  }
  async function connectInstagram() {
    setInstagramConnectedNotice(false);
    setInstagramBusy(true);
    try {
      const { url } = await api.post('/ai/instagram/connect');
      window.location.assign(url);
    } catch (err) {
      toast(err.message, 'error');
      setInstagramBusy(false);
    }
  }
  async function disconnectInstagram(account) {
    if (!window.confirm(`Desconectar a conta @${account.username}? Os agentes vinculados deixarão de responder pelo Instagram.`)) return;
    setInstagramDisconnecting(account.id);
    try {
      await api.del(`/ai/instagram/${account.id}`);
      toast('Conta do Instagram desconectada.');
      await load();
    } catch (err) { toast(err.message, 'error'); }
    finally { setInstagramDisconnecting(null); }
  }
  async function testAgent(agent) {
    setTesting(agent.id);
    try {
      const result = await api.post(`/ai/agents/${agent.id}/test`);
      toast(result.message);
      await load();
      await loadCredits();
    } catch (err) { toast(err.message, 'error'); }
    finally { setTesting(null); }
  }
  async function removeAgent(agent) {
    if (!window.confirm(`Excluir o agente "${agent.name}"? As conversas dele continuam na aba Conversas e podem ser apagadas por lá.`)) return;
    try {
      await api.del(`/ai/agents/${agent.id}`);
      toast('Agente excluído.');
      await load();
      if (selectedConversation?.agentId === agent.id) setSelectedConversation(null);
    } catch (err) { toast(err.message, 'error'); }
  }
  async function clearOrphans() {
    if (!window.confirm('Apagar todas as conversas de agentes excluídos?')) return;
    try {
      await api.del('/ai/conversations?orphans=1');
      setSelectedConversation(null);
      await loadConversations();
    } catch (err) { toast(err.message, 'error'); }
  }
  const selectedInstance = (instanceId) => data?.instances.find((instance) => instance.id === instanceId);
  const orderedConversations = [...conversations].sort((a, b) => {
    const direction = conversationOrder === 'oldest' ? 1 : -1;
    const activityA = a.lastMessage?.createdAt ?? a.updatedAt;
    const activityB = b.lastMessage?.createdAt ?? b.updatedAt;
    return direction * (activityA - activityB) || direction * (a.id - b.id);
  });
  const searchTerm = conversationSearch.trim().toLocaleLowerCase('pt-BR');
  const searchDigits = conversationSearch.replace(/\D/g, '');
  const filteredConversations = orderedConversations.filter((conversation) => {
    if (!searchTerm) return true;
    const searchable = [
      conversation.name,
      conversation.phone,
      formatStoredPhone(conversation.phone),
      conversation.agentName,
      conversation.lastMessage?.content,
      ...(conversation.labels || []),
    ].join(' ').toLocaleLowerCase('pt-BR');
    return searchable.includes(searchTerm)
      || (searchDigits.length >= 4 && String(conversation.phone || '').replace(/\D/g, '').includes(searchDigits));
  });

  return (
    <>
      <StoreBar />
      <header className="page-head head-row ai-page-head">
        <div><h1>Atendimento com IA</h1><HelpNote topic="ia" /></div>
        <div className="btn-group">
          <button type="button" className="btn btn-ghost" onClick={() => setWhatsappOpen(true)}><Icon name="chat" size={17} /> WhatsApp</button>
          {tab === 'agentes' && (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setNoAiMarketingOpen(true)}><Icon name="send" size={17} /> Marketing sem IA</button>
              <button type="button" className="btn btn-primary" onClick={() => setEditor({})}><Icon name="plus" size={18} /> Criar agente</button>
            </>
          )}
        </div>
      </header>
      <div className="ai-tabs" role="tablist" aria-label="Seções do atendimento com IA">
        {[['agentes', 'Agentes'], ['conversas', 'Conversas'], ['contatos', 'Contatos'], ['prompts', 'Prompts']].map(([key, label]) => (
          <button type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'is-active' : ''} key={key} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {error && <div className="alert alert-error" role="alert">{error} <button type="button" className="link-btn" onClick={load}>Tentar novamente</button></div>}
      {!data && !error && <div className="ai-loading"><span className="lamp lamp-lg is-pending" /> Carregando agentes...</div>}
      {data && tab === 'agentes' && (
        <div className="ai-content">
          <div className="ai-credit-note">
            <Icon name="sparkles" size={20} />
            <p><strong>Dm Soluções</strong><br />Seu atendimento usa créditos pré-pagos. O consumo considera tokens de entrada e saída.</p>
          </div>
          <section className="ai-credit-dashboard" aria-label="Saldo e consumo da Dm Soluções">
            <div className="ai-credit-dashboard-head">
              <div><h2>Créditos Dm Soluções</h2><p className="muted small">O consumo é calculado pelos tokens usados em cada resposta.</p></div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={refreshUsage}><Icon name="refresh" size={15} /> Atualizar</button>
            </div>
            {creditError && <p className="form-error" role="alert">{creditError}</p>}
            {credits && <>
              <div className="ai-credit-metrics">
                <article><span>Saldo disponível</span><strong>{formatCredits(credits.balanceMicros)}</strong></article>
                <article><span>Consumido neste mês</span><strong>{formatCredits(credits.monthlySpentMicros)}</strong></article>
                <article><span>Tokens de entrada</span><strong>{credits.monthlyTokens.input.toLocaleString('pt-BR')}</strong></article>
                <article><span>Tokens de saída</span><strong>{credits.monthlyTokens.output.toLocaleString('pt-BR')}</strong></article>
                <article><span>Áudio transcrito</span><strong>{formatDuration(credits.monthlyTokens.audioSeconds)}</strong></article>
              </div>
              {(!credits.configured || !credits.paymentsConfigured) && <p className="ai-credit-config-warning" role="status">A recarga e o atendimento ficarão disponíveis após a configuração do serviço.</p>}
              <div className="ai-credit-recharge">
                <label className="field"><span>Valor da recarga</span>
                  <select className="input" value={topUpAmount} onChange={(event) => setTopUpAmount(Number(event.target.value))}>
                    {TOP_UPS.map(([amount, label]) => <option value={amount} key={amount}>{label}</option>)}
                  </select>
                </label>
                <button type="button" className="btn btn-primary" onClick={rechargeCredits} disabled={topUpBusy || !credits.configured || !credits.paymentsConfigured}>
                  {topUpBusy ? 'Abrindo pagamento...' : 'Recarregar com InfinitePay'}
                </button>
              </div>
              <div className="ai-credit-history">
                <h3>Consumo e recargas recentes</h3>
                {!credits.transactions.length ? <p className="muted small">Ainda não há consumo ou recargas.</p> : credits.transactions.map((transaction) => (
                  <div className="ai-credit-history-row" key={transaction.id}>
                    <span>                    <strong>{transaction.type === 'topup' ? 'Recarga' : transaction.type === 'admin_adjustment' ? transaction.amountMicros.startsWith('-') ? 'Ajuste administrativo (retirada)' : 'Ajuste administrativo (crédito)' : 'Consumo de IA'}</strong><small>{fmtDate(transaction.createdAt)}{transaction.type === 'usage' ? ` · ${transaction.inputTokens.toLocaleString('pt-BR')} entrada / ${transaction.outputTokens.toLocaleString('pt-BR')} saída${transaction.audioSeconds ? ` · áudio ${formatDuration(transaction.audioSeconds)}` : ''}` : transaction.note ? ` · ${transaction.note}` : ''}</small></span>
                    <strong className={transaction.type === 'topup' || (transaction.type === 'admin_adjustment' && !transaction.amountMicros.startsWith('-')) ? 'is-credit' : 'is-charge'}>
                      {transaction.amountMicros.startsWith('-') ? '−' : '+'}{formatCredits(transaction.amountMicros.replace('-', ''))}
                    </strong>
                  </div>
                ))}
              </div>
            </>}
          </section>
          <section className="card ai-instagram-settings">
            <div className="ai-credit-dashboard-head">
              <div><h2>Instagram</h2><p className="muted small">Conecte a conta profissional da loja. Você será direcionado ao Instagram para verificar e autorizar o acesso.</p></div>
              <button type="button" className="btn btn-primary" onClick={connectInstagram} disabled={instagramBusy || !data.instagramConfigured} aria-describedby={!data.instagramConfigured ? 'instagram-setup-help' : undefined}>{instagramBusy ? 'Conectando...' : 'Conectar Instagram'}</button>
            </div>
            {instagramConnectedNotice && <div className="ai-instagram-success" role="status"><span>Instagram conectado com sucesso. Agora selecione esta conta ao configurar um agente de atendimento.</span><button type="button" className="link-btn" onClick={() => setInstagramConnectedNotice(false)}>Fechar</button></div>}
            {!data.instagramConfigured && <p className="ai-instagram-notice" id="instagram-setup-help" role="status">A conexão ainda não está disponível. Tente novamente mais tarde ou fale com o suporte.</p>}
            {data.instagramAccounts.length > 0 ? data.instagramAccounts.map((account) => (
              <div key={account.id} className="ai-credit-history-row">
                <span><strong>@{account.username}</strong><small>{account.canReceiveMessages ? 'Direct habilitado' : 'Direct sem permissão'} · {account.canReplyToComments ? 'comentários habilitados' : 'comentários sem permissão'}{!account.webhookSubscribed ? ' · ativação das mensagens pendente' : ''}</small></span>
                <button type="button" className="btn btn-ghost btn-sm icon-btn-danger" disabled={instagramDisconnecting === account.id} onClick={() => disconnectInstagram(account)}>{instagramDisconnecting === account.id ? 'Desconectando...' : 'Desconectar'}</button>
              </div>
            )) : <p className="muted small">Nenhuma conta conectada. Clique em “Conectar Instagram” para autorizar uma conta profissional.</p>}
          </section>
          {!data.agents.length ? (
            <div className="ai-empty"><Icon name="sparkles" size={28} /><h2>Crie seu primeiro agente</h2><p className="muted">Conecte o WhatsApp ou uma conta profissional do Instagram e configure o atendimento da Dm Soluções.</p><button className="btn btn-primary" onClick={() => setEditor({})}>Criar agente</button></div>
          ) : (
            <>
            <div className="ai-agent-grid">
              {data.agents.map((agent) => (
                <article className="ai-agent-card" key={agent.id}>
                  <div className="ai-agent-top"><div><span className={`ai-mode ${agent.mode}`}>{agent.mode === 'marketing' ? 'Marketing' : 'Atendimento'}</span><h2>{agent.name}</h2></div><span className={`ai-agent-state ${agent.active ? 'is-on' : ''}`}>{agent.active ? 'Ativo' : 'Pausado'}</span></div>
                  <p className="ai-agent-instance">{[selectedInstance(agent.instanceId)?.displayName, agent.respondInstagramDirect || agent.respondInstagramComments ? `Instagram ${[agent.respondInstagramDirect ? 'Direct' : '', agent.respondInstagramComments ? 'comentários' : ''].filter(Boolean).join(' + ')}` : ''].filter(Boolean).join(' · ') || 'Sem canal vinculado'}</p>
                  {agent.schedule?.enabled && <p className={`small ai-schedule-badge ${agent.withinSchedule ? 'is-on' : ''}`}>{agent.withinSchedule ? 'Dentro do horário' : 'Fora do horário'} · {agent.schedule.start}–{agent.schedule.end}</p>}
                  <div className="ai-usage-meter"><div><span>Respostas neste mês</span><strong>{agent.usage.requests} / {agent.monthlyLimit}</strong></div><progress max={agent.monthlyLimit} value={Math.min(agent.usage.requests, agent.monthlyLimit)} /></div>
                  <p className="muted small">{agent.usage.inputTokens.toLocaleString('pt-BR')} tokens de entrada · {agent.usage.outputTokens.toLocaleString('pt-BR')} de saída</p>
                  <div className="ai-agent-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditor(agent)}><Icon name="edit" size={16} /> Editar</button>
                    {agent.mode === 'atendimento' && <button className="btn btn-ghost btn-sm" onClick={() => setActionsAgent(agent)}><Icon name="sparkles" size={16} /> Funções</button>}
                    <button className="btn btn-ghost btn-sm" onClick={() => testAgent(agent)} disabled={testing === agent.id}>{testing === agent.id ? 'Testando...' : 'Testar Dm Soluções'}</button>
                    <button className="btn btn-ghost btn-sm icon-btn-danger" onClick={() => removeAgent(agent)}><Icon name="trash" size={16} /> Excluir</button>
                    {agent.mode === 'marketing' && <button className="btn btn-primary btn-sm" onClick={() => setCampaignAgent(agent)} disabled={!agent.active}><Icon name="send" size={16} /> Campanha ({agent.contactIds.length})</button>}
                  </div>
                </article>
              ))}
            </div>
            </>
          )}
          {data.instances.some((instance) => instance.provider === 'meta') && (
            <details className="ai-webhook-help">
              <summary>Configurar webhook para receber mensagens da API oficial da Meta</summary>
              <p>Cadastre esta URL no painel de desenvolvedores da Meta, use o token da instância abaixo e assine o campo <strong>messages</strong>. A instância precisa ter App Secret configurado.</p>
              <code>{data.webhook}</code>
              <ul>{data.instances.filter((instance) => instance.provider === 'meta').map((instance) => <li key={instance.id}><strong>{instance.displayName}</strong> · Token: <code>{instance.metaVerifyToken}</code></li>)}</ul>
              {!data.webhookPublic && <p className="form-error">O endereço atual parece local. A Meta só consegue chamar o webhook quando o sistema está publicado em HTTPS.</p>}
            </details>
          )}
        </div>
      )}
      {data && tab === 'conversas' && (
        <div className={`ai-inbox ${selectedConversation ? 'has-chat' : ''}`}>
          <aside className="ai-conversation-list">
            <div className="ai-conversation-filter">
              <div className="ai-conversation-list-head">
                <h2>Conversas</h2>
                <span>{filteredConversations.length} {filteredConversations.length === 1 ? 'conversa' : 'conversas'}</span>
              </div>
              <label className="field ai-conversation-search"><span>Buscar por cliente, telefone ou mensagem</span><input className="input" type="search" value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="Ex.: Maria ou 85999999999" /></label>
              <div className="ai-conversation-filters">
                <label className="field"><span>Filtrar por agente</span><select className="input" value={conversationAgent} onChange={(event) => setConversationAgent(event.target.value)}><option value="">Todos os agentes</option>{data.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}<option value="deleted">Agentes excluídos</option></select></label>
                <label className="field"><span>Ordenar conversas</span><select className="input" value={conversationOrder} onChange={(event) => setConversationOrder(event.target.value)}><option value="recent">Mais recentes primeiro</option><option value="oldest">Mais antigas primeiro</option></select></label>
              </div>
              {conversationAgent === 'deleted' && conversations.length > 0 && <button type="button" className="btn btn-ghost btn-sm icon-btn-danger" onClick={clearOrphans}><Icon name="trash" size={16} /> Apagar todas</button>}
            </div>
            {filteredConversations.map((conversation) => (
              <button type="button" className={`ai-conversation-item ${selectedConversation?.id === conversation.id ? 'is-selected' : ''}`} key={conversation.id} onClick={() => setSelectedConversation(conversation)}>
                <span className="ai-avatar">{(conversation.name || conversation.phone).slice(0, 1).toUpperCase()}</span>
                <span className="ai-conversation-summary">
                  <strong>{conversation.channel?.startsWith('instagram_') ? conversation.name || 'Contato do Instagram' : conversation.name || formatStoredPhone(conversation.phone)}{conversation.status === 'interrupted' && <em className="ai-tag-interrupted">Interrompida</em>}</strong>
                  <small className="ai-conversation-channel">{conversation.channel === 'instagram_direct' ? 'Instagram · Direct' : conversation.channel === 'instagram_comment' ? 'Instagram · Comentário' : 'WhatsApp'} · {conversation.agentName}{conversation.agentDeleted ? ' (excluído)' : ''}</small>
                  <small className="ai-conversation-preview">{conversation.labels?.length ? `${conversation.labels.join(', ')} · ` : ''}{conversation.lastMessage?.content || 'Sem mensagens'}</small>
                </span>
                <time>{fmtDate(conversation.lastMessage?.createdAt ?? conversation.updatedAt)}</time>
              </button>
            ))}
            {!conversations.length && <p className="ai-no-conversations">As conversas recebidas pelos agentes de atendimento aparecerão aqui.</p>}
            {conversations.length > 0 && !filteredConversations.length && <p className="ai-no-conversations">Nenhuma conversa encontrada. Tente outro nome, telefone ou mensagem.</p>}
          </aside>
          <ChatPanel conversation={selectedConversation} onClose={() => setSelectedConversation(null)} onChanged={loadConversations} />
        </div>
      )}
      {data && tab === 'contatos' && <ContactsPanel folders={data.folders} onChanged={load} />}
      {data && tab === 'prompts' && <PromptsPanel prompts={data.prompts} builtin={data.builtinPrompts} onChanged={load} />}
      {actionsAgent && <ActionsModal agent={actionsAgent} onClose={() => setActionsAgent(null)} />}
      {campaignAgent && <CampaignModal agent={campaignAgent} onClose={() => setCampaignAgent(null)} />}
      {noAiMarketingOpen && data && <NoAiMarketingModal data={data} onClose={() => setNoAiMarketingOpen(false)} />}
      {editor && data && <AgentEditor initial={editor} data={data} onClose={() => setEditor(null)} onSaved={load} onConnectInstagram={connectInstagram} instagramConnecting={instagramBusy} />}
      {whatsappOpen && <WhatsAppManagerModal onClose={() => { setWhatsappOpen(false); load(); }} />}
    </>
  );
}
