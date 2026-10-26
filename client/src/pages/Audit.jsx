import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import BuyMore from '../components/BuyMore.jsx';
import { useAuth } from '../auth.jsx';
import InstanceManager from '../components/InstanceManager.jsx';
import ChatList from '../components/audit/ChatList.jsx';
import ChatView from '../components/audit/ChatView.jsx';
import ChatSide from '../components/audit/ChatSide.jsx';
import { useToast } from '../components/Toast.jsx';
import { useInstances } from '../lib/useInstances.js';
import { plural } from '../lib/format.js';

const EMPTY = { q: '', instanceId: '', labelId: '', unread: false, kind: 'all', days: 60 }; // days: 7, 30 ou 60 (as mensagens com mais de 60 dias são apagadas sozinhas)
const POLL_MS = 4000; // canal de segurança: pergunta ao servidor o que chegou (funciona mesmo se o tempo real for barrado)
const REFRESH_MS = 30000; // atualiza a lista inteira (nomes, não lidas, ordem) de tempos em tempos

// Auditoria: acompanha ao vivo as conversas dos números conectados. Só leitura (responder é do plano Ouro).
// Três caminhos levam a mensagem até a tela: tempo real (SSE), consulta rápida a cada 4 s e busca automática do servidor.
export default function Audit() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: inst, reload: reloadInst } = useInstances(15000, '/audit/instances');
  const [labels, setLabels] = useState([]);
  const [filters, setFilters] = useState(EMPTY);
  const [chats, setChats] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ unreadTotal: 0, unreadChats: 0, totalChats: 0 });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [liveItems, setLiveItems] = useState([]);
  const [liveStatus, setLiveStatus] = useState(null);
  const [liveEdit, setLiveEdit] = useState(null);
  const [liveMedia, setLiveMedia] = useState(null);
  const [online, setOnline] = useState(false);
  const [syncing, setSyncing] = useState(null);
  const [manager, setManager] = useState(false);
  const [side, setSide] = useState(false);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const instRef = useRef([]);
  instRef.current = inst?.instances || [];
  const chatsRef = useRef([]);
  chatsRef.current = chats;
  const seq = useRef(0);
  const selectedRef = useRef(null);
  selectedRef.current = selectedId;
  const cursor = useRef(null); // última mensagem que o canal de segurança já entregou
  const seen = useRef(new Set()); // mensagens já entregues (não repetir)

  const instances = inst?.instances || [];
  const hasInstances = instances.length > 0;
  const canSend = Boolean(user.limits.auditSend);

  const matchesFilters = (dto) => {
    const f = filtersRef.current;
    if (f.q.trim() || f.labelId || f.unread) return false; // com busca/etiqueta/"não lidas" a lista é recarregada do servidor
    if (f.instanceId && Number(f.instanceId) !== dto.instanceId) return false;
    if (f.kind === 'groups' && !dto.isGroup) return false;
    if (f.kind === 'direct' && dto.isGroup) return false;
    return true;
  };

  // Atualiza (ou cria) uma conversa na lista e acerta o contador de não lidas.
  const upsertChat = useCallback((incoming) => {
    // Conversa aberta com a aba à vista: a mensagem já nasce como lida (a conversa avisa o servidor), sem o contador piscar.
    const dto = selectedRef.current === incoming.id && !document.hidden ? { ...incoming, unread: 0 } : incoming;
    const old = chatsRef.current.find((c) => c.id === dto.id);
    const before = old ? old.unread : 0;
    if (dto.unread !== before) {
      setStats((s) => ({
        ...s,
        unreadTotal: Math.max(0, s.unreadTotal + dto.unread - before),
        unreadChats: Math.max(0, s.unreadChats + (dto.unread > 0 ? 1 : 0) - (before > 0 ? 1 : 0)),
      }));
    }
    setChats((prev) => {
      const cur = prev.find((c) => c.id === dto.id);
      if (!cur && !matchesFilters(dto)) return prev;
      const label = instRef.current.find((i) => i.id === dto.instanceId);
      const merged = cur
        ? { ...cur, ...dto, labelIds: dto.labelIds ?? cur.labelIds, instanceLabel: dto.instanceLabel ?? cur.instanceLabel, match: cur.match }
        : { ...dto, labelIds: dto.labelIds ?? [], instanceLabel: dto.instanceLabel ?? (label?.label || label?.metaPhoneDisplay || null) };
      return [merged, ...prev.filter((c) => c.id !== dto.id)].sort((a, b) => b.lastMessageAt - a.lastMessageAt || b.id - a.id);
    });
    // Mantém a referência em dia para várias mensagens chegando no mesmo instante.
    chatsRef.current = old ? chatsRef.current.map((c) => (c.id === dto.id ? { ...c, unread: dto.unread } : c)) : chatsRef.current;
  }, []);

  // ---------- lista de conversas ----------
  const queryString = (f, extra = {}) => {
    const params = new URLSearchParams();
    if (f.q.trim()) params.set('q', f.q.trim());
    if (f.instanceId) params.set('instanceId', f.instanceId);
    if (f.labelId) params.set('labelId', f.labelId);
    if (f.unread) params.set('unread', '1');
    if (f.kind !== 'all') params.set('kind', f.kind);
    params.set('days', f.days);
    for (const [k, v] of Object.entries(extra)) if (v != null) params.set(k, v);
    return params;
  };

  const loadChats = useCallback(async ({ more = false, before = null } = {}) => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const r = await api.get(`/audit/chats?${queryString(filtersRef.current, more ? { before } : {})}`);
      if (mine !== seq.current) return; // chegou uma busca mais nova
      setChats((prev) => (more ? [...prev, ...r.chats.filter((c) => !prev.some((p) => p.id === c.id))] : r.chats));
      setNextBefore(r.nextBefore);
      setStats({ unreadTotal: r.unreadTotal, unreadChats: r.unreadChats, totalChats: r.totalChats });
      if (cursor.current === null) cursor.current = r.cursor;
    } catch (e) {
      if (mine === seq.current) toast(e.message, 'error');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(() => loadChats(), filters.q ? 350 : 0);
    return () => clearTimeout(t);
  }, [filters, loadChats]);

  useEffect(() => { api.get('/audit/labels').then((r) => setLabels(r.labels)).catch(() => {}); }, []);

  // Atualização da lista sem perder o que você já rolou: troca/adiciona as conversas do topo e mantém o resto.
  const refreshTop = useCallback(async () => {
    try {
      const r = await api.get(`/audit/chats?${queryString(filtersRef.current)}`);
      setStats({ unreadTotal: r.unreadTotal, unreadChats: r.unreadChats, totalChats: r.totalChats });
      setChats((prev) => {
        const byId = new Map(prev.map((c) => [c.id, c]));
        for (const c of r.chats) byId.set(c.id, { ...byId.get(c.id), ...c });
        return [...byId.values()].sort((a, b) => b.lastMessageAt - a.lastMessageAt || b.id - a.id);
      });
    } catch { /* tenta de novo no próximo ciclo */ }
  }, []);

  // ---------- chegada de mensagens (qualquer canal) ----------
  const deliver = useCallback((items) => {
    const fresh = items.filter((it) => {
      if (seen.current.has(it.message.id)) return false;
      seen.current.add(it.message.id);
      return true;
    });
    if (seen.current.size > 5000) seen.current = new Set([...seen.current].slice(-2000));
    if (!fresh.length) return;
    for (const it of fresh) upsertChat(it.chat);
    setLiveItems(fresh);
  }, [upsertChat]);

  // Canal 1: tempo real (Server-Sent Events). O navegador reconecta sozinho.
  useEffect(() => {
    const es = new EventSource('/api/audit/stream');
    let first = true;
    es.onopen = () => {
      setOnline(true);
      if (!first) refreshTop(); // voltou depois de uma queda: busca o que perdeu
      first = false;
    };
    es.onerror = () => setOnline(false);
    es.onmessage = (e) => {
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }
      if (ev.type === 'message') deliver([ev]);
      else if (ev.type === 'chat') upsertChat(ev.chat);
      else if (ev.type === 'status') setLiveStatus(ev);
      else if (ev.type === 'edit') setLiveEdit(ev);
      else if (ev.type === 'media') setLiveMedia(ev);
      else if (ev.type === 'sync') { setSyncing(ev.running ? ev : null); if (!ev.running) { refreshTop(); reloadInst(); } }
      else if (ev.type === 'connection') reloadInst();
    };
    return () => es.close();
  }, [deliver, upsertChat, refreshTop, reloadInst]);

  // Canal 2: pergunta ao servidor a cada poucos segundos o que chegou depois da última mensagem conhecida.
  useEffect(() => {
    let stop = false;
    let busy = false;
    const poll = async () => {
      if (busy || stop || cursor.current === null) return;
      busy = true;
      try {
        for (let guard = 0; guard < 10 && !stop; guard++) {
          const r = await api.get(`/audit/updates?after=${cursor.current}`);
          cursor.current = r.cursor;
          const byChat = new Map(r.chats.map((c) => [c.id, c]));
          deliver(r.messages.map((m) => ({ chat: byChat.get(m.chatId), message: m })).filter((it) => it.chat));
          if (!r.more) break;
        }
      } catch { /* sem rede por um instante: tenta no próximo */ } finally { busy = false; }
    };
    const t = setInterval(poll, POLL_MS);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [deliver]);

  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) refreshTop(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [refreshTop]);

  // O título da aba mostra quantas conversas têm mensagens não lidas.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = stats.unreadChats ? `(${stats.unreadChats}) ${base}` : base;
    return () => { document.title = base; };
  }, [stats.unreadChats]);

  async function select(id) {
    setSelectedId(id);
    setSide(false);
    try {
      const { chat } = await api.get(`/audit/chats/${id}`);
      if (selectedRef.current === id) setDetail(chat);
    } catch (e) { toast(e.message, 'error'); }
  }

  const onRead = useCallback((id) => {
    const old = chatsRef.current.find((c) => c.id === id);
    if (old?.unread) {
      setStats((s) => ({ ...s, unreadTotal: Math.max(0, s.unreadTotal - old.unread), unreadChats: Math.max(0, s.unreadChats - 1) }));
      setChats((l) => l.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
    }
  }, []);
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
            Acompanhe ao vivo as conversas dos seus números, com etiquetas, anotações e busca por palavra-chave.
            {canSend ? ' No seu plano você também pode responder.' : ' No seu plano você só visualiza as conversas.'}
          </p>
        </div>
        <div className="btn-row">
          <span className={`au-live ${online ? 'is-on' : ''}`} role="status" title={online ? 'Recebendo mensagens em tempo real' : 'Sem o tempo real: a tela continua se atualizando a cada poucos segundos'}><i />{online ? 'Ao vivo' : 'Atualizando...'}</span>
          {hasInstances && <button className="btn btn-ghost" onClick={() => setManager((m) => !m)} aria-expanded={manager}>Números conectados ({instances.length}/{inst?.limit ?? user.limits.auditInstances})</button>}
                   <BuyMore resource="auditInstances" label="Adquirir mais números" />
                 </div>
      </header>

      {syncing && (
        <div className="banner banner-amber au-sync" role="status">
          <div><strong>Importando conversas...</strong><span>{syncing.total ? `${syncing.done} de ${plural(syncing.total, 'conversa', 'conversas')}` : 'Buscando'} · {plural(syncing.imported, 'mensagem importada', 'mensagens importadas')}. Pode continuar usando: o resto aparece sozinho.</span></div>
        </div>
      )}

      {(manager || (inst && !hasInstances)) && (
        <section className="card">
          <InstanceManager purpose="auditoria" />
          <p className="muted small au-legal">Conecte apenas números que você tem autorização para acompanhar e avise as pessoas envolvidas, conforme a LGPD.</p>
        </section>
      )}

      {hasInstances && (
        <div className={`au-app ${selectedId ? 'is-open' : ''} ${side ? 'is-side' : ''}`}>
          <ChatList chats={chats} selectedId={selectedId} onSelect={select} filters={filters} setFilters={setFilters} instances={instances} labels={labels}
            loading={loading} hasMore={Boolean(nextBefore)} onMore={() => loadChats({ more: true, before: nextBefore })} stats={stats} />
          {view ? (
            <>
              <ChatView key={`${view.id}-${filters.days}`} days={filters.days} chat={view} canSend={canSend} liveItems={liveItems} liveStatus={liveStatus} liveEdit={liveEdit} liveMedia={liveMedia}
                onBack={back} onRead={onRead} onSent={() => {}} onSide={() => setSide(true)} />
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
