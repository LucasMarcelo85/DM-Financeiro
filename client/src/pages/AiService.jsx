import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import CsvTransfer from '../components/CsvTransfer.jsx';
import Icon from '../components/Icon.jsx';
import { useToast } from '../components/Toast.jsx';
import { formatStoredPhone } from '../lib/format.js';
import { importCsvBatches } from '../lib/csv.js';

const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', model: 'gemini-2.0-flash' },
  { id: 'openai', name: 'ChatGPT', model: 'gpt-4o-mini' },
  { id: 'claude', name: 'Claude', model: 'claude-3-5-haiku-latest' },
];
const CONTACT_COLUMNS = [
  { key: 'name', type: 'string' }, { key: 'phone', type: 'string' }, { key: 'email', type: 'string' },
  { key: 'notes', type: 'string' }, { key: 'document', type: 'string' }, { key: 'zip', type: 'string' },
  { key: 'street', type: 'string' }, { key: 'number', type: 'string' }, { key: 'complement', type: 'string' },
  { key: 'district', type: 'string' }, { key: 'city', type: 'string' }, { key: 'state', type: 'string' },
  { key: 'createdAt', type: 'date' },
];
const fmtDate = (timestamp) => new Date(timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

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
  }));
  const [saving, setSaving] = useState(false);
  const selectedContacts = useMemo(() => new Set(form.contactIds), [form.contactIds]);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const setMode = (mode) => setForm((current) => ({
    ...current,
    mode,
    prompt: current.prompt === data.templates[current.mode] ? data.templates[mode] : current.prompt,
  }));
  const toggleContact = (phone) => {
    if (!selectedContacts.has(phone) && selectedContacts.size >= 100) {
      toast('Cada campanha pode ter até 100 contatos selecionados.', 'error');
      return;
    }
    setForm((current) => ({
      ...current,
      contactIds: current.contactIds.includes(phone)
        ? current.contactIds.filter((item) => item !== phone)
        : [...current.contactIds, phone],
    }));
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
                <legend>Contatos da campanha <small>({selectedContacts.size}/100 selecionados; clientes cadastrados e clientes de pedidos)</small></legend>
                <div className="ai-contact-options">
                  {data.contacts.map((contact) => (
                    <label className="ai-contact-option" key={contact.id}>
                      <input type="checkbox" checked={selectedContacts.has(contact.id)} onChange={() => toggleContact(contact.id)} />
                      <span><strong>{contact.name}</strong><small>{formatStoredPhone(contact.phone)} · {contact.source === 'pedido' ? 'Pedido do site' : 'Cliente'}</small></span>
                    </label>
                  ))}
                  {!data.contacts.length && <p className="muted small">Cadastre clientes ou receba pedidos para escolher contatos.</p>}
                </div>
              </fieldset>
            </>
          )}
          <label className="field"><span>Limite mensal de respostas IA</span>
            <input className="input" type="number" min="1" max="100000" value={form.monthlyLimit} onChange={set('monthlyLimit')} required />
            <small>Controla quantas respostas geradas pela IA podem ser feitas no mês. O limite não controla os preços cobrados diretamente pelo provedor.</small>
          </label>
          <label className="field"><span>Prompt do agente</span>
            <textarea className="input ai-prompt" value={form.prompt} onChange={set('prompt')} minLength={20} maxLength={12000} required />
            <small>Edite livremente o modelo. No atendimento, pedidos recentes deste telefone são incluídos como contexto privado.</small>
          </label>
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

function ChatPanel({ conversation, onClose }) {
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
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
    } catch (error) { toast(error.message, 'error'); }
    finally { setSending(false); }
  }
  if (!conversation) return <div className="ai-chat-empty"><Icon name="chat" size={28} /><p>Selecione uma conversa para visualizar as mensagens em tempo real.</p></div>;
  return (
    <section className="ai-chat">
      <header className="ai-chat-head">
        <button type="button" className="icon-btn ai-chat-back" onClick={onClose} aria-label="Voltar às conversas"><Icon name="left" /></button>
        <div><strong>{conversation.name || formatStoredPhone(conversation.phone)}</strong><small>{formatStoredPhone(conversation.phone)} · {conversation.agentName}</small></div>
      </header>
      <div className="ai-chat-messages">
        {messages.map((message) => (
          <article key={message.id} className={`ai-bubble ${message.role === 'user' ? 'is-inbound' : message.role === 'human' ? 'is-human' : message.role === 'error' ? 'is-error' : 'is-ai'}`}>
            <p>{message.content}</p><small>{message.role === 'user' ? 'Cliente' : message.role === 'human' ? 'Atendente' : message.role === 'error' ? 'Aviso' : 'IA'} · {fmtDate(message.createdAt)}</small>
          </article>
        ))}
        {!messages.length && <p className="muted">Ainda não há mensagens nesta conversa.</p>}
      </div>
      <form className="ai-chat-send" onSubmit={send}>
        <input className="input" value={text} onChange={(event) => setText(event.target.value)} maxLength={6000} placeholder="Responder manualmente..." aria-label="Mensagem" />
        <button className="btn btn-primary" disabled={sending || !text.trim()}><Icon name="send" size={17} /> Enviar</button>
      </form>
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
  const [campaignText, setCampaignText] = useState('');
  const [campaignBusy, setCampaignBusy] = useState(null);
  const [testing, setTesting] = useState(null);

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
    if (!window.confirm(`Excluir o agente "${agent.name}" e o histórico de conversas associado?`)) return;
    try {
      await api.del(`/ai/agents/${agent.id}`);
      toast('Agente excluído.');
      await load();
      if (selectedConversation?.agentId === agent.id) setSelectedConversation(null);
    } catch (err) { toast(err.message, 'error'); }
  }
  async function campaign(agent) {
    if (!window.confirm('Enviar uma mensagem personalizada para os contatos selecionados? A ação fará envios pelo WhatsApp.')) return;
    setCampaignBusy(agent.id);
    try {
      const result = await api.post(`/ai/agents/${agent.id}/campaign`, { message: campaignText });
      toast(`${result.sent} mensagem(ns) enviada(s); ${result.failed.length} falha(s).`, result.failed.length ? 'error' : 'ok');
      await load();
    } catch (err) { toast(err.message, 'error'); }
    finally { setCampaignBusy(null); }
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
        {[['agentes', 'Agentes'], ['conversas', 'Conversas'], ['contatos', 'Contatos']].map(([key, label]) => (
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
            {data.agents.some((agent) => agent.mode === 'marketing') && (
              <label className="field ai-campaign-copy"><span>Objetivo ou contexto da campanha</span><textarea className="input" value={campaignText} onChange={(event) => setCampaignText(event.target.value)} maxLength={1000} placeholder="Ex.: apresentar a coleção nova e convidar para ver os produtos no site." /><small>O agente personaliza este texto para cada contato selecionado.</small></label>
            )}
            <div className="ai-agent-grid">
              {data.agents.map((agent) => (
                <article className="ai-agent-card" key={agent.id}>
                  <div className="ai-agent-top"><div><span className={`ai-mode ${agent.mode}`}>{agent.mode === 'marketing' ? 'Marketing' : 'Atendimento'}</span><h2>{agent.name}</h2></div><span className={`ai-agent-state ${agent.active ? 'is-on' : ''}`}>{agent.active ? 'Ativo' : 'Pausado'}</span></div>
                  <p className="muted small">{PROVIDERS.find((provider) => provider.id === agent.provider)?.name} · {agent.model}</p>
                  <p className="ai-agent-instance">{selectedInstance(agent.instanceId)?.displayName || 'Sem instância vinculada'}</p>
                  <div className="ai-usage-meter"><div><span>Respostas neste mês</span><strong>{agent.usage.requests} / {agent.monthlyLimit}</strong></div><progress max={agent.monthlyLimit} value={Math.min(agent.usage.requests, agent.monthlyLimit)} /></div>
                  <p className="muted small">{agent.usage.inputTokens.toLocaleString('pt-BR')} tokens de entrada · {agent.usage.outputTokens.toLocaleString('pt-BR')} de saída</p>
                  <div className="ai-agent-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditor(agent)}><Icon name="edit" size={16} /> Editar</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => testAgent(agent)} disabled={testing === agent.id}>{testing === agent.id ? 'Testando...' : 'Testar credencial'}</button>
                    <button className="btn btn-ghost btn-sm icon-btn-danger" onClick={() => removeAgent(agent)}><Icon name="trash" size={16} /> Excluir</button>
                    {agent.mode === 'marketing' && <button className="btn btn-primary btn-sm" onClick={() => campaign(agent)} disabled={!agent.active || campaignBusy === agent.id}>{campaignBusy === agent.id ? 'Enviando...' : `Enviar campanha (${agent.contactIds.length})`}</button>}
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
              <label className="field"><span>Filtrar por agente</span><select className="input" value={conversationAgent} onChange={(event) => setConversationAgent(event.target.value)}><option value="">Todos os agentes</option>{data.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
            </div>
            {conversations.map((conversation) => (
              <button type="button" className={`ai-conversation-item ${selectedConversation?.id === conversation.id ? 'is-selected' : ''}`} key={conversation.id} onClick={() => setSelectedConversation(conversation)}>
                <span className="ai-avatar">{(conversation.name || conversation.phone).slice(0, 1).toUpperCase()}</span>
                <span className="ai-conversation-summary"><strong>{conversation.name || formatStoredPhone(conversation.phone)}</strong><small>{conversation.agentName} · {conversation.lastMessage?.content || 'Sem mensagens'}</small></span>
                <time>{fmtDate(conversation.updatedAt)}</time>
              </button>
            ))}
            {!conversations.length && <p className="ai-no-conversations">As conversas recebidas pelos agentes de atendimento aparecerão aqui.</p>}
          </aside>
          <ChatPanel conversation={selectedConversation} onClose={() => setSelectedConversation(null)} />
        </div>
      )}
      {data && tab === 'contatos' && (
        <section className="ai-contacts-panel">
          <header><div><h2>Contatos e clientes</h2><p className="muted">Clientes cadastrados e números encontrados nos pedidos do site podem ser selecionados nos agentes de marketing.</p></div>
            <CsvTransfer resource="contacts" title="clientes" filename="clientes.csv" exportUrl="/contacts/export" columns={CONTACT_COLUMNS}
              description="Exporte os dados cadastrais completos dos clientes."
              onImport={async (contacts) => {
                const result = await importCsvBatches(contacts, (batch) => api.post('/contacts/import', { contacts: batch }), 500, 2 * 1024 * 1024);
                await load();
                return result;
              }}
            />
          </header>
          <div className="ai-contact-table">
            <div className="ai-contact-table-head"><span>Nome</span><span>Telefone</span><span>Origem</span></div>
            {data.contacts.map((contact) => <div className="ai-contact-row" key={contact.id}><strong>{contact.name}</strong><span>{formatStoredPhone(contact.phone)}</span><span>{contact.source === 'pedido' ? 'Pedido do site' : 'Clientes'}</span></div>)}
            {!data.contacts.length && <p className="muted">Não há clientes ou pedidos com telefone disponíveis.</p>}
          </div>
        </section>
      )}
      {editor && data && <AgentEditor initial={editor} data={data} onClose={() => setEditor(null)} onSaved={load} />}
    </>
  );
}
