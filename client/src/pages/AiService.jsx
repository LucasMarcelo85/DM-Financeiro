import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import ContactsPanel from '../components/ai/ContactsPanel.jsx';
import ActionsModal from '../components/ai/ActionsModal.jsx';
import CampaignModal from '../components/ai/CampaignModal.jsx';
import PromptsPanel from '../components/ai/PromptsPanel.jsx';
import Icon from '../components/Icon.jsx';
import { useToast } from '../components/Toast.jsx';
import { formatStoredPhone } from '../lib/format.js';

const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', model: 'gemini-2.0-flash' },
  { id: 'openai', name: 'ChatGPT', model: 'gpt-4o-mini' },
  { id: 'claude', name: 'Claude', model: 'claude-3-5-haiku-latest' },
];
const fmtDate = (timestamp) => new Date(timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const typedPhone = (value) => {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return digits.length >= 12 && digits.length <= 15 ? digits : '';
};

function AgentEditor({ initial, data, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(initial?.id);
  const [form, setForm] = useState(() => ({
    name: initial?.name || '',
    provider: initial?.provider || 'gemini',
    model: initial?.model || 'gemini-2.0-flash',
    mode: initial?.mode || 'atendimento',
    prompt: initial?.prompt || data.templates.atendimento,
    apiKey: '',
    monthlyLimit: initial?.monthlyLimit || 100,
    instanceId: initial?.instanceId || '',
    contactIds: initial?.contactIds || [],
    active: initial?.active ?? true,
    schedule: { enabled: false, days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00', from: '', until: '', ...(initial?.schedule || {}) },
  }));
  const setSchedule = (key, value) => setForm((current) => ({ ...current, schedule: { ...current.schedule, [key]: value } }));
  const toggleDay = (day) => setSchedule('days', form.schedule.days.includes(day) ? form.schedule.days.filter((item) => item !== day) : [...form.schedule.days, day]);
  const [saving, setSaving] = useState(false);
  const [folderId, setFolderId] = useState(data.folders[0]?.id || '');
  const [manualNumber, setManualNumber] = useState('');
  const selectedContacts = useMemo(() => new Set(form.contactIds), [form.contactIds]);
  const folder = data.folders.find((item) => item.id === folderId);
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
  const setMode = (mode) => setForm((current) => {
    const isDefault = !current.prompt.trim() || [...data.builtinPrompts, ...data.prompts].some((item) => item.content === current.prompt);
    const next = isDefault ? (data.templates[mode] || current.prompt) : current.prompt;
    return { ...current, mode, prompt: next };
  });
  const usePrompt = (key) => {
    const chosen = promptOptions.find((item) => item.key === key);
    if (!chosen) return;
    if (form.prompt.trim() && ![...data.builtinPrompts, ...data.prompts].some((item) => item.content === form.prompt) && !window.confirm('Substituir o prompt atual pelo prompt escolhido?')) return;
    setForm((current) => ({ ...current, prompt: chosen.content }));
  };
  const addPhones = (phones) => {
    const fresh = phones.filter((phone) => !selectedContacts.has(phone));
    if (selectedContacts.size + fresh.length > 100) {
      toast('Cada campanha pode ter até 100 contatos selecionados.', 'error');
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
    setSaving(true);
    try {
      const payload = {
        ...form, instanceId: form.instanceId || null, monthlyLimit: Number(form.monthlyLimit),
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
          <div><h2 id="ai-editor-title">{editing ? 'Editar agente' : 'Criar agente de IA'}</h2><p className="muted small">As credenciais são guardadas criptografadas e nunca aparecem novamente.</p></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar"><Icon name="x" /></button>
        </div>
        <form className="ai-form" onSubmit={submit}>
          <div className="form-row">
            <label className="field"><span>Nome do agente</span><input className="input" value={form.name} onChange={set('name')} required minLength={2} maxLength={80} placeholder="Ex.: Atendimento da loja" /></label>
            <label className="field"><span>Tipo de agente</span>
              <select className="input" value={form.mode} onChange={(event) => setMode(event.target.value)}>
                <option value="atendimento">Atendimento — responde mensagens</option>
                <option value="marketing">Marketing — cria e envia mensagens</option>
              </select>
            </label>
          </div>
          <div className="form-row">
            <label className="field"><span>Provedor de IA</span>
              <select className="input" value={form.provider} onChange={(event) => {
                const provider = PROVIDERS.find((item) => item.id === event.target.value);
                setForm((current) => ({ ...current, provider: provider.id, model: provider.model }));
              }}>
                {PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Modelo</span><input className="input" value={form.model} onChange={set('model')} required maxLength={100} /></label>
          </div>
          <label className="field"><span>Chave de API {editing && <small>(em branco mantém a chave atual)</small>}</span>
            <input className="input" type="password" autoComplete="new-password" value={form.apiKey} onChange={set('apiKey')} required={!editing} maxLength={1000} placeholder={editing ? '••••••••••••' : 'Cole a chave de API do provedor'} />
          </label>
          {form.mode === 'atendimento' ? (
            <label className="field"><span>Instância para atendimento</span>
              <select className="input" value={form.instanceId} onChange={set('instanceId')} required>
                <option value="">Selecione uma instância WhatsApp</option>
                {data.instances.map((instance) => <option key={instance.id} value={instance.id}>{instance.displayName} · {instance.provider === 'meta' ? 'API Meta' : 'QR Code'}</option>)}
              </select>
            </label>
          ) : (
            <>
              <label className="field"><span>Instância para envio</span>
                <select className="input" value={form.instanceId} onChange={set('instanceId')} required>
                  <option value="">Selecione uma instância WhatsApp</option>
                  {data.instances.map((instance) => <option key={instance.id} value={instance.id}>{instance.displayName} · {instance.provider === 'meta' ? 'API Meta' : 'QR Code'}</option>)}
                </select>
              </label>
              <fieldset className="ai-contact-select">
                <legend>Contatos da campanha <small>({selectedContacts.size}/100 selecionados)</small></legend>
                <div className="ai-folder-picker">
                  <select className="input" value={folderId} onChange={(event) => setFolderId(event.target.value)} aria-label="Pasta de contatos">
                    {data.folders.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.contacts.length})</option>)}
                  </select>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={toggleFolder} disabled={!folder?.contacts.length}>{folderAllSelected ? 'Desmarcar a pasta' : 'Selecionar a pasta toda'}</button>
                </div>
                <div className="ai-contact-options">
                  {folder?.contacts.map((contact) => (
                    <label className="ai-contact-option" key={contact.id}>
                      <input type="checkbox" checked={selectedContacts.has(contact.phone)} onChange={() => toggleContact(contact.phone)} />
                      <span><strong>{contact.name}</strong><small>{formatStoredPhone(contact.phone)}</small></span>
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
            <small>Edite livremente. Crie e organize seus prompts na aba Prompts. No atendimento, pedidos deste telefone entram como contexto privado e o agente também lê imagens, áudios e arquivos enviados pelo cliente.</small>
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
  const [sending, setSending] = useState(false);
  const orphan = conversation?.agentDeleted;
  const interrupted = conversation?.status === 'interrupted';
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
  if (!conversation) return <div className="ai-chat-empty"><Icon name="chat" size={28} /><p>Selecione uma conversa para visualizar as mensagens em tempo real.</p></div>;
  const roleLabel = { user: 'Cliente', human: 'Atendente', error: 'Aviso', action: 'Função' };
  return (
    <section className="ai-chat">
      <header className="ai-chat-head">
        <button type="button" className="icon-btn ai-chat-back" onClick={onClose} aria-label="Voltar às conversas"><Icon name="left" /></button>
        <div><strong>{conversation.name || formatStoredPhone(conversation.phone)}</strong><small>{formatStoredPhone(conversation.phone)} · {conversation.agentName}{orphan ? ' (agente excluído)' : ''}</small></div>
        <div className="btn-group ai-chat-tools">
          {!orphan && (interrupted
            ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => control('resume')}>Retomar agente</button>
            : <button type="button" className="btn btn-ghost btn-sm" onClick={() => control('interrupt')}>Interromper agente</button>)}
          <button type="button" className="btn btn-ghost btn-sm icon-btn-danger" onClick={() => control('delete')}><Icon name="trash" size={16} /> Apagar</button>
        </div>
      </header>
      {interrupted && <div className="ai-interrupted-note">Conversa interrompida: o agente não responde automaticamente até ser retomado.</div>}
      <div className="ai-chat-messages">
        {messages.map((message) => (
          <article key={message.id} className={`ai-bubble ${message.role === 'user' ? 'is-inbound' : message.role === 'human' ? 'is-human' : message.role === 'error' ? 'is-error' : message.role === 'action' ? 'is-action' : 'is-ai'}`}>
            <p>{message.content}</p><small>{roleLabel[message.role] || 'IA'} · {fmtDate(message.createdAt)}</small>
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
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('agentes');
  const [editor, setEditor] = useState(null);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [conversationAgent, setConversationAgent] = useState('');
  const [campaignAgent, setCampaignAgent] = useState(null);
  const [testing, setTesting] = useState(null);
  const [actionsAgent, setActionsAgent] = useState(null);

  const load = useCallback(async () => {
    try {
      const result = await api.get('/ai');
      setData(result);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);
  const loadConversations = useCallback(async () => {
    try {
      const result = await api.get(`/ai/conversations${conversationAgent ? `?agentId=${conversationAgent}` : ''}`);
      setConversations(result.conversations);
      if (selectedConversation) {
        const fresh = result.conversations.find((item) => item.id === selectedConversation.id);
        if (fresh) setSelectedConversation(fresh);
      }
    } catch (err) { setError(err.message); }
  }, [conversationAgent, selectedConversation?.id]);

  useEffect(() => { load(); }, [load]);
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
      toast('Uso atualizado.');
    } catch (err) { toast(err.message, 'error'); }
  }
  async function testAgent(agent) {
    setTesting(agent.id);
    try {
      const result = await api.post(`/ai/agents/${agent.id}/test`);
      toast(result.message);
      await load();
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

  return (
    <>
      <header className="page-head head-row ai-page-head">
        <div><h1>Atendimento com IA</h1><p className="muted">Configure Gemini, ChatGPT ou Claude para campanhas e conversas WhatsApp.</p></div>
        <div className="btn-group">
          <button type="button" className="btn btn-ghost" onClick={refreshUsage}><Icon name="refresh" size={17} /> Atualizar uso</button>
          {tab === 'agentes' && <button type="button" className="btn btn-primary" onClick={() => setEditor({})}><Icon name="plus" size={18} /> Criar agente</button>}
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
            <p><strong>Uso e recarga</strong><br />O painel contabiliza respostas e tokens usados aqui. A cobrança e a recarga de créditos são feitas diretamente pelo provedor.</p>
            {data.billingUrls && <div className="ai-provider-links">{PROVIDERS.map((provider) => <a key={provider.id} href={data.billingUrls[provider.id]} target="_blank" rel="noreferrer">Recarregar {provider.name} <Icon name="external" size={14} /></a>)}</div>}
          </div>
          {!data.agents.length ? (
            <div className="ai-empty"><Icon name="sparkles" size={28} /><h2>Crie seu primeiro agente</h2><p className="muted">Escolha um provedor, conecte uma instância WhatsApp e configure o prompt.</p><button className="btn btn-primary" onClick={() => setEditor({})}>Criar agente</button></div>
          ) : (
            <>
            <div className="ai-agent-grid">
              {data.agents.map((agent) => (
                <article className="ai-agent-card" key={agent.id}>
                  <div className="ai-agent-top"><div><span className={`ai-mode ${agent.mode}`}>{agent.mode === 'marketing' ? 'Marketing' : 'Atendimento'}</span><h2>{agent.name}</h2></div><span className={`ai-agent-state ${agent.active ? 'is-on' : ''}`}>{agent.active ? 'Ativo' : 'Pausado'}</span></div>
                  <p className="muted small">{PROVIDERS.find((provider) => provider.id === agent.provider)?.name} · {agent.model}</p>
                  <p className="ai-agent-instance">{selectedInstance(agent.instanceId)?.displayName || 'Sem instância vinculada'}</p>
                  {agent.schedule?.enabled && <p className={`small ai-schedule-badge ${agent.withinSchedule ? 'is-on' : ''}`}>{agent.withinSchedule ? 'Dentro do horário' : 'Fora do horário'} · {agent.schedule.start}–{agent.schedule.end}</p>}
                  <div className="ai-usage-meter"><div><span>Respostas neste mês</span><strong>{agent.usage.requests} / {agent.monthlyLimit}</strong></div><progress max={agent.monthlyLimit} value={Math.min(agent.usage.requests, agent.monthlyLimit)} /></div>
                  <p className="muted small">{agent.usage.inputTokens.toLocaleString('pt-BR')} tokens de entrada · {agent.usage.outputTokens.toLocaleString('pt-BR')} de saída</p>
                  <div className="ai-agent-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditor(agent)}><Icon name="edit" size={16} /> Editar</button>
                    {agent.mode === 'atendimento' && <button className="btn btn-ghost btn-sm" onClick={() => setActionsAgent(agent)}><Icon name="sparkles" size={16} /> Funções</button>}
                    <button className="btn btn-ghost btn-sm" onClick={() => testAgent(agent)} disabled={testing === agent.id}>{testing === agent.id ? 'Testando...' : 'Testar credencial'}</button>
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
              <label className="field"><span>Filtrar por agente</span><select className="input" value={conversationAgent} onChange={(event) => setConversationAgent(event.target.value)}><option value="">Todos os agentes</option>{data.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}<option value="deleted">Agentes excluídos</option></select></label>
              {conversationAgent === 'deleted' && conversations.length > 0 && <button type="button" className="btn btn-ghost btn-sm icon-btn-danger" onClick={clearOrphans}><Icon name="trash" size={16} /> Apagar todas</button>}
            </div>
            {conversations.map((conversation) => (
              <button type="button" className={`ai-conversation-item ${selectedConversation?.id === conversation.id ? 'is-selected' : ''}`} key={conversation.id} onClick={() => setSelectedConversation(conversation)}>
                <span className="ai-avatar">{(conversation.name || conversation.phone).slice(0, 1).toUpperCase()}</span>
                <span className="ai-conversation-summary"><strong>{conversation.name || formatStoredPhone(conversation.phone)}{conversation.status === 'interrupted' && <em className="ai-tag-interrupted">Interrompida</em>}</strong><small>{conversation.agentName}{conversation.agentDeleted ? ' (excluído)' : ''} · {conversation.lastMessage?.content || 'Sem mensagens'}</small></span>
                <time>{fmtDate(conversation.updatedAt)}</time>
              </button>
            ))}
            {!conversations.length && <p className="ai-no-conversations">As conversas recebidas pelos agentes de atendimento aparecerão aqui.</p>}
          </aside>
          <ChatPanel conversation={selectedConversation} onClose={() => setSelectedConversation(null)} onChanged={loadConversations} />
        </div>
      )}
      {data && tab === 'contatos' && <ContactsPanel folders={data.folders} onChanged={load} />}
      {data && tab === 'prompts' && <PromptsPanel prompts={data.prompts} builtin={data.builtinPrompts} onChanged={load} />}
      {actionsAgent && <ActionsModal agent={actionsAgent} onClose={() => setActionsAgent(null)} />}
      {campaignAgent && <CampaignModal agent={campaignAgent} onClose={() => setCampaignAgent(null)} />}
      {editor && data && <AgentEditor initial={editor} data={data} onClose={() => setEditor(null)} onSaved={load} />}
    </>
  );
}
