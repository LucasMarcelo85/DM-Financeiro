import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import InstanceManager from '../components/InstanceManager.jsx';
import ChatList from '../components/audit/ChatList.jsx';
import ChatView from '../components/audit/ChatView.jsx';
import ChatSide from '../components/audit/ChatSide.jsx';
import { useToast } from '../components/Toast.jsx';
import { useInstances } from '../lib/useInstances.js';

const EMPTY = { q: '', instanceId: '', labelId: '', unread: false };

// Auditoria: acompanha em tempo real as conversas dos números conectados. Só leitura
// (responder é do plano Ouro). Etiquetas, anotações e busca por palavra-chave por conversa.
export default function Audit() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: inst, reload: reloadInst } = useInstances(15000, '/audit/instances');
  const [labels, setLabels] = useState([]);
  const [filters, setFilters] = useState(EMPTY);
  const [chats, setChats] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [liveMsg, setLiveMsg] = useState(null);
  const [liveStatus, setLiveStatus] = useState(null);
  const [online, setOnline] = useState(false);
  const [manager, setManager] = useState(false);
  const [side, setSide] = useState(false);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const instRef = useRef([]);
  instRef.current = inst?.instances || [];
  const seq = useRef(0);
  const selectedRef = useRef(null);
  selectedRef.current = selectedId;

  const instances = inst?.instances || [];
  const hasInstances = instances.length > 0;
  const canSend = Boolean(user.limits.auditSend);

  const loadChats = useCallback(async ({ more = false, before = null } = {}) => {
    const f = filtersRef.current;
    const params = new URLSearchParams();
    if (f.q.trim()) params.set('q', f.q.trim());
    if (f.instanceId) params.set('instanceId', f.instanceId);
    if (f.labelId) params.set('labelId', f.labelId);
    if (f.unread) params.set('unread', '1');
    if (more && before) params.set('before', before);
    const mine = ++seq.current;
    setLoading(true);
    try {
      const r = await api.get(`/audit/chats?${params}`);
      if (mine !== seq.current) return; // chegou uma busca mais nova
      setChats((prev) => (more ? [...prev, ...r.chats.filter((c) => !prev.some((p) => p.id === c.id))] : r.chats));
      setNextBefore(r.nextBefore);
    } catch (e) {
      if (mine === seq.current) toast(e.message, 'error');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [toast]);

  // Filtros e busca: recarrega a lista (com um respiro enquanto digita).
  useEffect(() => {
    const t = setTimeout(() => loadChats(), filters.q ? 350 : 0);
    return () => clearTimeout(t);
  }, [filters, loadChats]);

  useEffect(() => { api.get('/audit/labels').then((r) => setLabels(r.labels)).catch(() => {}); }, []);

  const upsertChat = useCallback((dto) => {
    setChats((prev) => {
      const old = prev.find((c) => c.id === dto.id);
      const f = filtersRef.current;
      if (!old && (f.q || f.labelId || f.unread || (f.instanceId && Number(f.instanceId) !== dto.instanceId))) return prev; // não combina com o filtro atual
      const label = instRef.current.find((i) => i.id === dto.instanceId);
      const merged = old
        ? { ...old, ...dto, labelIds: old.labelIds, instanceLabel: old.instanceLabel, match: undefined }
        : { ...dto, labelIds: [], instanceLabel: label?.label || label?.metaPhoneDisplay || null };
      return [merged, ...prev.filter((c) => c.id !== dto.id)].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    });
  }, []);

  // Tempo real (Server-Sent Events): o navegador reconecta sozinho se a conexão cair.
  useEffect(() => {
    const es = new EventSource('/api/audit/stream');
    let first = true;
    es.onopen = () => {
      setOnline(true);
      if (!first) loadChats(); // voltou depois de uma queda: busca o que perdeu
      first = false;
    };
    es.onerror = () => setOnline(false);
    es.onmessage = (e) => {
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }
      if (ev.type === 'message') {
        upsertChat(ev.chat);
        setLiveMsg(ev);
      } else if (ev.type === 'status') setLiveStatus(ev);
      else if (ev.type === 'connection') reloadInst();
    };
    return () => es.close();
  }, [loadChats, upsertChat, reloadInst]);

  async function select(id) {
    setSelectedId(id);
    setSide(false);
    try {
      const { chat } = await api.get(`/audit/chats/${id}`);
      if (selectedRef.current === id) setDetail(chat);
    } catch (e) { toast(e.message, 'error'); }
  }

  const onRead = useCallback((id) => setChats((l) => l.map((c) => (c.id === id && c.unread ? { ...c, unread: 0 } : c))), []);
  const onLabelIds = (ids) => {
    setDetail((d) => (d ? { ...d, labelIds: ids } : d));
    setChats((l) => l.map((c) => (c.id === selectedId ? { ...c, labelIds: ids } : c)));
  };
  const back = () => { setSelectedId(null); setDetail(null); setSide(false); };

  const shown = detail && chats.find((c) => c.id === detail.id);
  const view = detail ? { ...detail, ...(shown ? { name: shown.name, phone: shown.phone } : {}) } : null;

  return (
    <>
      <header className="page-head head-row">
        <div>
          <h1>Auditoria</h1>
          <p className="muted">
            Acompanhe em tempo real as conversas dos seus números, com etiquetas, anotações e busca por palavra-chave.
            {canSend ? ' No seu plano você também pode responder.' : ' No seu plano você só visualiza as conversas.'}
          </p>
        </div>
        <div className="btn-row">
          <span className={`au-live ${online ? 'is-on' : ''}`} role="status"><i />{online ? 'Ao vivo' : 'Reconectando...'}</span>
          {hasInstances && <button className="btn btn-ghost" onClick={() => setManager((m) => !m)} aria-expanded={manager}>Números conectados ({instances.length}/{inst?.limit ?? user.limits.auditInstances})</button>}
        </div>
      </header>

      {(manager || (inst && !hasInstances)) && (
        <section className="card">
          <InstanceManager purpose="auditoria" />
          <p className="muted small au-legal">Conecte apenas números que você tem autorização para acompanhar e avise as pessoas envolvidas, conforme a LGPD.</p>
        </section>
      )}

      {hasInstances && (
        <div className={`au-app ${selectedId ? 'is-open' : ''} ${side ? 'is-side' : ''}`}>
          <ChatList chats={chats} selectedId={selectedId} onSelect={select} filters={filters} setFilters={setFilters} instances={instances} labels={labels}
            loading={loading} hasMore={Boolean(nextBefore)} onMore={() => loadChats({ more: true, before: nextBefore })} live={online} />
          {view ? (
            <>
              <ChatView key={view.id} chat={view} canSend={canSend} liveMsg={liveMsg} liveStatus={liveStatus} onBack={back} onRead={onRead} onSent={() => {}} onSide={() => setSide(true)} />
              <ChatSide chat={view} labels={labels} setLabels={setLabels} onLabelIds={onLabelIds} onClose={() => setSide(false)} />
            </>
          ) : (
            <div className="au-placeholder"><strong>Selecione uma conversa</strong><span>As mensagens novas aparecem na lista e na conversa na mesma hora.</span></div>
          )}
        </div>
      )}
    </>
  );
}
