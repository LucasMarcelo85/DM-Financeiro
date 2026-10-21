import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useToast } from '../Toast.jsx';
import EIcon from '../contract/EIcon.jsx';
import { chatTitle, clock, dayLabel, highlightParts, insertSorted, mediaUrl, phoneLabel, sameDay } from '../../lib/audit.js';

const TICKS = { sent: '✓', delivered: '✓✓', read: '✓✓', failed: '!' };

// Foto, figurinha, vídeo, áudio ou documento. Se o arquivo não puder ser baixado, mostra a miniatura (quando existe) e um aviso.
function MediaBlock({ m, version, onOpen }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [version]);
  const q = version ? `?v=${version}` : '';
  const src = mediaUrl(m.id, q);
  const thumb = m.media.thumb ? mediaUrl(m.id, `?thumb=1${version ? `&v=${version}` : ''}`) : null;
  const unavailable = <span className="au-media-off">Mídia indisponível (o WhatsApp pode ter apagado o arquivo)</span>;

  if (m.type === 'image' || m.type === 'sticker') {
    if (failed) return thumb ? <><img className="au-img is-thumb" src={thumb} alt="Miniatura" />{unavailable}</> : unavailable;
    return <img className={`au-img ${m.type === 'sticker' ? 'is-sticker' : ''}`} src={src} alt={m.type === 'sticker' ? 'Figurinha' : 'Foto'} loading="lazy" onError={() => setFailed(true)} onClick={() => onOpen(src)} />;
  }
  if (m.type === 'video') {
    if (failed) return thumb ? <><img className="au-img is-thumb" src={thumb} alt="Miniatura do vídeo" />{unavailable}</> : unavailable;
    return <video className="au-video" controls preload="none" poster={thumb || undefined} src={src} onError={() => setFailed(true)} />;
  }
  if (m.type === 'audio') {
    if (failed) return unavailable;
    return (
      <span className="au-audio">
        <audio controls preload="none" src={src} onError={() => setFailed(true)} />
        {m.media.seconds ? <small>{Math.floor(m.media.seconds / 60)}:{String(m.media.seconds % 60).padStart(2, '0')}</small> : null}
      </span>
    );
  }
  return <a className="au-doc" href={mediaUrl(m.id, '?download=1')} download>{m.media.name || m.body || 'Baixar arquivo'}</a>;
}

function Body({ m, q, version, onOpen }) {
  const showText = m.body && !(m.type === 'document' && m.body === m.media?.name);
  return (
    <>
      {m.media && <MediaBlock m={m} version={version} onOpen={onOpen} />}
      
      {(m.type === 'location' || m.type === 'contact') && <span className="au-media">{m.type === 'location' ? 'Localização' : 'Contato'}</span>}
      {showText && <span className="au-text">{highlightParts(m.body, q).map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : <Fragment key={i}>{p.t}</Fragment>))}</span>}
    </>
  );
}

export default function ChatView({ chat, canSend, liveItems, liveStatus, liveEdit, liveMedia, onBack, onRead, onSent, onSide }) {
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState({ open: false, q: '', matches: [], total: 0, idx: -1 });
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [fresh, setFresh] = useState(0); // mensagens novas chegaram enquanto você lia mais acima
  const [versions, setVersions] = useState({}); // força recarregar a mídia que acabou de ser baixada
  const [lightbox, setLightbox] = useState(null);
  const scroller = useRef(null);
  const stick = useRef(true); // true = está no fim da conversa (acompanha as mensagens novas)
  const keepFrom = useRef(null); // posição a manter ao carregar mensagens antigas
  const focusId = useRef(null);
  const chatId = chat.id;

  const toBottom = () => requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; });

  const loadLatest = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/audit/chats/${chatId}/messages`);
      setMessages(r.messages);
      setHasOlder(r.hasOlder);
      setHasNewer(false);
      setFresh(0);
      stick.current = true;
      toBottom();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [chatId, toast]);

  // Troca de conversa: carrega do zero, marca como lida e limpa a busca.
  useEffect(() => {
    setSearch({ open: false, q: '', matches: [], total: 0, idx: -1 });
    setText('');
    loadLatest();
    api.post(`/audit/chats/${chatId}/read`).then(() => onRead(chatId)).catch(() => {});
  }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mensagens novas (tempo real ou consulta rápida): entram na posição certa, mesmo as que chegam atrasadas.
  useEffect(() => {
    const mine = (liveItems || []).filter((it) => it.chat.id === chatId);
    if (!mine.length) return;
    if (hasNewer) { setFresh((n) => n + mine.length); return; }
    setMessages((list) => mine.reduce((acc, it) => insertSorted(acc, it.message), list));
    if (stick.current) toBottom(); else setFresh((n) => n + mine.length);
    if (!document.hidden && mine.some((it) => !it.message.fromMe)) api.post(`/audit/chats/${chatId}/read`).then(() => onRead(chatId)).catch(() => {});
  }, [liveItems]); // eslint-disable-line react-hooks/exhaustive-deps

  // Atualiza os "vistos" das mensagens enviadas.
  useEffect(() => {
    if (liveStatus && liveStatus.chatId === chatId) setMessages((list) => list.map((m) => (m.id === liveStatus.messageId ? { ...m, status: liveStatus.status } : m)));
  }, [liveStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (liveEdit && liveEdit.chatId === chatId) setMessages((list) => list.map((m) => (m.id === liveEdit.messageId ? { ...m, body: liveEdit.body } : m)));
  }, [liveEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (liveMedia && liveMedia.chatId === chatId) setVersions((v) => ({ ...v, [liveMedia.messageId]: (v[liveMedia.messageId] || 0) + 1 }));
  }, [liveMedia]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadOlder() {
    const first = messages[0];
    if (!first) return;
    const box = scroller.current;
    keepFrom.current = box ? box.scrollHeight - box.scrollTop : null;
    try {
      const r = await api.get(`/audit/chats/${chatId}/messages?before=${first.ts}_${first.id}`);
      setMessages((list) => [...r.messages, ...list]);
      setHasOlder(r.hasOlder);
    } catch (e) { toast(e.message, 'error'); }
  }

  // Depois de carregar mensagens antigas, mantém a tela no mesmo ponto; ao saltar para uma busca, centraliza.
  useEffect(() => {
    const box = scroller.current;
    if (keepFrom.current != null && box) { box.scrollTop = box.scrollHeight - keepFrom.current; keepFrom.current = null; }
    if (focusId.current != null) {
      const el = box?.querySelector(`[data-msg="${focusId.current}"]`);
      if (el) { el.scrollIntoView({ block: 'center' }); focusId.current = null; }
    }
  }, [messages]);

  function onScroll() {
    const b = scroller.current;
    stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 80;
    if (stick.current && fresh && !hasNewer) setFresh(0);
  }

  // ---------- Busca por palavra-chave na conversa ----------
  useEffect(() => {
    const q = search.q.trim();
    if (!search.open || q.length < 2) { setSearch((s) => (s.matches.length || s.total ? { ...s, matches: [], total: 0, idx: -1 } : s)); return undefined; }
    const t = setTimeout(async () => {
      try {
        const r = await api.get(`/audit/chats/${chatId}/search?q=${encodeURIComponent(q)}`);
        setSearch((s) => (s.q.trim() === q ? { ...s, matches: r.matches, total: r.total, idx: r.matches.length ? 0 : -1 } : s));
        if (r.matches.length) jump(r.matches[0].id);
      } catch (e) { toast(e.message, 'error'); }
    }, 350);
    return () => clearTimeout(t);
  }, [search.q, search.open, chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function jump(messageId) {
    focusId.current = messageId;
    if (messages.some((m) => m.id === messageId)) {
      const el = scroller.current?.querySelector(`[data-msg="${messageId}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      focusId.current = null;
      return;
    }
    try {
      const r = await api.get(`/audit/chats/${chatId}/messages?around=${messageId}`);
      stick.current = false;
      setMessages(r.messages);
      setHasOlder(r.hasOlder);
      setHasNewer(r.hasNewer);
    } catch (e) { toast(e.message, 'error'); }
  }

  const step = (d) => {
    const n = search.matches.length;
    if (!n) return;
    const idx = (search.idx + d + n) % n;
    setSearch((s) => ({ ...s, idx }));
    jump(search.matches[idx].id);
  };
  const activeMatch = search.idx >= 0 ? search.matches[search.idx]?.id : null;

  async function send(e) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await api.post(`/audit/chats/${chatId}/send`, { text: body });
      setText('');
      setMessages((list) => (list.some((m) => m.id === r.message.id) ? list : [...list, r.message]));
      stick.current = true;
      toBottom();
      onSent?.();
    } catch (err) { toast(err.message, 'error'); } finally { setSending(false); }
  }

  const title = chatTitle(chat);
  return (
    <section className="au-view" aria-label={`Conversa com ${title}`}>
      <header className="au-view-head">
        <button type="button" className="ce-mini au-back" onClick={onBack} aria-label="Voltar para as conversas"><EIcon name="back" /></button>
        <div className="au-view-title">
          <strong>{title}</strong>
          <span className="muted small">{[chat.isGroup ? 'Grupo' : phoneLabel(chat.phone), chat.instanceLabel].filter(Boolean).join(' · ')}</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm au-side-open" onClick={onSide}>Detalhes</button>
        <button type="button" className={`ce-mini ${search.open ? 'is-on' : ''}`} onClick={() => setSearch((s) => ({ ...s, open: !s.open }))} aria-label="Buscar palavra na conversa" title="Buscar na conversa" aria-pressed={search.open}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" /><path d="M21 21l-4.3-4.3" /></svg>
        </button>
      </header>

      {search.open && (
        <div className="au-find">
          <input className="input input-sm" autoFocus type="search" placeholder="Palavra-chave nesta conversa..." value={search.q} onChange={(e) => setSearch((s) => ({ ...s, q: e.target.value }))} aria-label="Palavra-chave nesta conversa"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? 1 : -1); } if (e.key === 'Escape') setSearch((s) => ({ ...s, open: false, q: '' })); }} />
          <span className="au-find-count" aria-live="polite">
            {search.q.trim().length < 2 ? '' : search.total === 0 ? 'Nada encontrado' : `${search.idx + 1} de ${search.total}${search.total > search.matches.length ? '+' : ''}`}
          </span>
          <button type="button" className="ce-mini" onClick={() => step(1)} disabled={!search.matches.length} aria-label="Resultado mais antigo" title="Mais antigo"><EIcon name="up" size={16} /></button>
          <button type="button" className="ce-mini" onClick={() => step(-1)} disabled={!search.matches.length} aria-label="Resultado mais recente" title="Mais recente"><EIcon name="down" size={16} /></button>
        </div>
      )}

      <div className="au-msgs" ref={scroller} onScroll={onScroll}>
        {hasOlder && <button type="button" className="btn btn-ghost btn-sm au-older" onClick={loadOlder}>Carregar mensagens anteriores</button>}
        {loading && <p className="au-empty">Carregando...</p>}
        {messages.map((m, i) => (
          <Fragment key={m.id}>
            {(i === 0 || !sameDay(messages[i - 1].ts, m.ts)) && <div className="au-day"><span>{dayLabel(m.ts)}</span></div>}
            <div data-msg={m.id} className={`au-msg ${m.fromMe ? 'is-me' : 'is-them'} ${activeMatch === m.id ? 'is-focus' : ''}`}>
              {chat.isGroup && !m.fromMe && (m.sender || m.senderPhone) && <b className="au-sender" title={m.senderPhone ? phoneLabel(m.senderPhone) : undefined}>{m.sender || phoneLabel(m.senderPhone)}</b>}
              <Body m={m} q={search.open ? search.q : ''} version={versions[m.id]} onOpen={setLightbox} />
              <span className="au-meta"><time>{clock(m.ts)}</time>{m.fromMe && m.status && <i className={`au-tick is-${m.status}`} aria-label={`Status: ${m.status}`}>{TICKS[m.status]}</i>}</span>
            </div>
          </Fragment>
        ))}
        {hasNewer && <button type="button" className="btn btn-ghost btn-sm au-older" onClick={loadLatest}>Ir para as mensagens mais recentes{fresh ? ` (${fresh} nova${fresh > 1 ? 's' : ''})` : ''}</button>}
      </div>
      {fresh > 0 && !hasNewer && <button type="button" className="au-fresh" onClick={() => { stick.current = true; setFresh(0); toBottom(); }}>↓ {fresh} nova{fresh > 1 ? 's' : ''} mensagem{fresh > 1 ? 's' : ''}</button>}

      {canSend ? (
        <form className="au-compose" onSubmit={send}>
          <textarea className="input" rows={1} value={text} placeholder="Escreva uma resposta..." maxLength={4000} aria-label="Mensagem" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="btn btn-primary" disabled={!text.trim() || sending} aria-label="Enviar mensagem">{sending ? 'Enviando...' : 'Enviar'}</button>
        </form>
      ) : (
        <div className="au-readonly">
          <span><strong>Somente leitura.</strong> Responder pela auditoria faz parte do plano Ouro.</span>
          <Link className="btn btn-ghost btn-sm" to="/plano">Ver planos</Link>
        </div>
      )}
      {lightbox && (
        <div className="au-lightbox" role="dialog" aria-modal="true" aria-label="Foto ampliada" onClick={() => setLightbox(null)} onKeyDown={(e) => { if (e.key === 'Escape') setLightbox(null); }} tabIndex={-1} ref={(el) => el?.focus()}>
          <img src={lightbox} alt="Foto ampliada" />
          <a className="btn btn-ghost btn-sm" href={`${lightbox.split('?')[0]}?download=1`} download onClick={(e) => e.stopPropagation()}>Baixar</a>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLightbox(null)}>Fechar</button>
        </div>
      )}
    </section>
  );
}
