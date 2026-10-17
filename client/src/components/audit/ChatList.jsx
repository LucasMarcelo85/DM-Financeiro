import { chatTitle, initials, listTime } from '../../lib/audit.js';

export default function ChatList({ chats, selectedId, onSelect, filters, setFilters, instances, labels, loading, hasMore, onMore, live }) {
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const labelById = Object.fromEntries(labels.map((l) => [l.id, l]));
  return (
    <section className="au-list" aria-label="Conversas">
      <div className="au-search">
        <input className="input" type="search" placeholder="Buscar nome, número ou palavra-chave..." value={filters.q} onChange={set('q')} aria-label="Buscar em todas as conversas" />
      </div>
      <div className="au-filters">
        {instances.length > 1 && (
          <select className="input input-sm" value={filters.instanceId} onChange={set('instanceId')} aria-label="Filtrar por número">
            <option value="">Todos os números</option>
            {instances.map((i) => <option key={i.id} value={i.id}>{i.label || i.metaPhoneDisplay || i.name}</option>)}
          </select>
        )}
        {labels.length > 0 && (
          <select className="input input-sm" value={filters.labelId} onChange={set('labelId')} aria-label="Filtrar por etiqueta">
            <option value="">Todas as etiquetas</option>
            {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
        <label className="au-check"><input type="checkbox" checked={filters.unread} onChange={(e) => setFilters((f) => ({ ...f, unread: e.target.checked }))} /> Não lidas</label>
      </div>

      <ul className="au-chats">
        {chats.map((c) => {
          const title = chatTitle(c);
          const preview = c.match ?? (c.lastText || '');
          return (
            <li key={c.id}>
              <button type="button" className={`au-chat ${selectedId === c.id ? 'is-on' : ''} ${c.unread ? 'is-unread' : ''}`} onClick={() => onSelect(c.id)}>
                <span className={`au-avatar ${c.isGroup ? 'is-group' : ''}`} aria-hidden="true">{c.isGroup ? 'G' : initials(title)}</span>
                <span className="au-chat-main">
                  <span className="au-chat-top"><strong>{title}</strong><time>{listTime(c.lastMessageAt)}</time></span>
                  <span className="au-chat-bottom">
                    <span className={`au-preview ${c.match ? 'is-match' : ''}`}>{c.lastFromMe && !c.match ? 'Você: ' : ''}{preview}</span>
                    {c.unread > 0 && <b className="au-badge" aria-label={`${c.unread} não lidas`}>{c.unread > 99 ? '99+' : c.unread}</b>}
                  </span>
                  {(c.labelIds?.length > 0 || instances.length > 1) && (
                    <span className="au-chips">
                      {c.labelIds?.map((id) => labelById[id] && <i key={id} className="au-chip" style={{ '--c': labelById[id].color }}>{labelById[id].name}</i>)}
                      {instances.length > 1 && c.instanceLabel && <i className="au-chip is-inst">{c.instanceLabel}</i>}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!loading && chats.length === 0 && (
        <p className="au-empty">{filters.q || filters.labelId || filters.unread || filters.instanceId ? 'Nenhuma conversa encontrada com esses filtros.' : live ? 'Nenhuma conversa ainda. As mensagens aparecem aqui assim que chegarem.' : 'Nenhuma conversa ainda.'}</p>
      )}
      {loading && <p className="au-empty">Carregando...</p>}
      {hasMore && !loading && <button type="button" className="btn btn-ghost btn-sm au-more" onClick={onMore}>Carregar mais conversas</button>}
    </section>
  );
}
