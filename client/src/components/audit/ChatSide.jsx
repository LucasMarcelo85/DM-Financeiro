import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { useToast } from '../Toast.jsx';
import Modal from '../Modal.jsx';
import { LABEL_COLORS, clock, chatTitle, phoneLabel } from '../../lib/audit.js';

function Notes({ chatId, initial, updatedAt }) {
  const toast = useToast();
  const [text, setText] = useState(initial || '');
  const [state, setState] = useState(updatedAt ? `Salvo às ${clock(updatedAt)}` : '');
  const timer = useRef(null);
  const latest = useRef({ chatId, text, dirty: false });
  latest.current.chatId = chatId;

  const save = async (value = latest.current.text, id = latest.current.chatId) => {
    setState('Salvando...');
    try {
      const r = await api.put(`/audit/chats/${id}/note`, { note: value });
      if (latest.current.chatId === id) { latest.current.dirty = false; setState(r.note ? `Salvo às ${clock(r.noteUpdatedAt)}` : ''); }
    } catch (e) { setState('Não foi possível salvar'); toast(e.message, 'error'); }
  };

  const change = (e) => {
    const v = e.target.value;
    setText(v);
    latest.current = { chatId, text: v, dirty: true };
    setState('Digitando...');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(v, chatId), 800);
  };

  // Ao trocar de conversa ou sair, grava o que ficou pendente.
  useEffect(() => () => {
    clearTimeout(timer.current);
    const l = latest.current;
    if (l.dirty) api.put(`/audit/chats/${l.chatId}/note`, { note: l.text }).catch(() => {});
  }, [chatId]);

  return (
    <div className="au-notes">
      <textarea className="input" rows={7} value={text} onChange={change} maxLength={20000} placeholder="Escreva aqui o que você precisa lembrar sobre este contato..." aria-label="Bloco de anotações" />
      <span className="muted small" aria-live="polite">{state || 'Salvamento automático'}</span>
    </div>
  );
}

export default function ChatSide({ chat, labels, setLabels, onLabelIds, onClose }) {
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const [del, setDel] = useState(null);
  const ids = chat.labelIds || [];

  async function toggle(id) {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    onLabelIds(next); // atualiza na hora
    try { await api.put(`/audit/chats/${chat.id}/labels`, { labelIds: next }); } catch (e) { onLabelIds(ids); toast(e.message, 'error'); }
  }

  async function create(e) {
    e.preventDefault();
    try {
      const { label } = await api.post('/audit/labels', { name, color });
      setLabels((l) => [...l, { ...label, count: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
      setName('');
      setCreating(false);
      await toggle(label.id);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function remove(l) {
    setDel(null);
    try {
      await api.del(`/audit/labels/${l.id}`);
      setLabels((list) => list.filter((x) => x.id !== l.id));
      onLabelIds(ids.filter((x) => x !== l.id));
    } catch (err) { toast(err.message, 'error'); }
  }

  return (
    <aside className="au-side" aria-label="Detalhes do contato">
      <header className="au-side-head">
        <strong>{chatTitle(chat)}</strong>
        <button type="button" className="btn btn-ghost btn-sm au-side-close" onClick={onClose}>Fechar</button>
      </header>
      <dl className="au-info">
        {!chat.isGroup && chat.phone && (<><dt>Número</dt><dd>{phoneLabel(chat.phone)}</dd></>)}
        {chat.instanceLabel && (<><dt>Conexão</dt><dd>{chat.instanceLabel}</dd></>)}
        <dt>Tipo</dt><dd>{chat.isGroup ? 'Grupo' : 'Contato'}</dd>
      </dl>

      <section className="au-sec">
        <h3>Etiquetas</h3>
        <div className="au-label-list">
          {labels.map((l) => (
            <span key={l.id} className="au-label-wrap">
              <button type="button" className={`au-label ${ids.includes(l.id) ? 'is-on' : ''}`} style={{ '--c': l.color }} onClick={() => toggle(l.id)} aria-pressed={ids.includes(l.id)}>{l.name}</button>
              <button type="button" className="au-label-x" onClick={() => setDel(l)} aria-label={`Excluir etiqueta ${l.name}`} title="Excluir etiqueta">×</button>
            </span>
          ))}
          {labels.length === 0 && !creating && <span className="muted small">Nenhuma etiqueta ainda.</span>}
        </div>
        {creating ? (
          <form className="au-label-form" onSubmit={create}>
            <input className="input input-sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="Nome (ex.: Cliente VIP)" autoFocus required aria-label="Nome da etiqueta" />
            <div className="au-swatches" role="radiogroup" aria-label="Cor da etiqueta">
              {LABEL_COLORS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Cor ${c}`} className={color === c ? 'is-on' : ''} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
            </div>
            <div className="btn-row"><button className="btn btn-primary btn-sm">Criar e aplicar</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>Cancelar</button></div>
          </form>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(true)}>+ Nova etiqueta</button>
        )}
      </section>

      <section className="au-sec">
        <h3>Bloco de anotações</h3>
        <Notes key={chat.id} chatId={chat.id} initial={chat.note} updatedAt={chat.noteUpdatedAt} />
      </section>

      {del && (
        <Modal title="Excluir etiqueta?" onClose={() => setDel(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setDel(null)}>Cancelar</button><button className="btn btn-danger" onClick={() => remove(del)}>Excluir</button></>}>
          <p>A etiqueta <strong>{del.name}</strong> será removida de todas as conversas.</p>
        </Modal>
      )}
    </aside>
  );
}
