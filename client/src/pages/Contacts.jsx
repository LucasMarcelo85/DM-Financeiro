import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { formatStoredPhone, initials, maskPhone, plural } from '../lib/format.js';

function ContactForm({ initial, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: initial?.name || '', phone: initial?.phone ? formatStoredPhone(initial.phone) : '', email: initial?.email || '', notes: initial?.notes || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = initial ? await api.patch(`/contacts/${initial.id}`, f) : await api.post('/contacts', f);
      toast(initial ? 'Cliente atualizado.' : 'Cliente salvo.');
      onSaved(r.contact);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <Modal title={initial ? 'Editar cliente' : 'Novo cliente'} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <label className="field"><span>Nome</span><input className="input" value={f.name} onChange={set('name')} autoFocus autoComplete="off" /></label>
        <label className="field"><span>WhatsApp</span><input className="input" type="tel" inputMode="tel" value={f.phone} placeholder="(85) 99999-9999" onChange={(e) => setF((x) => ({ ...x, phone: maskPhone(e.target.value) }))} autoComplete="off" /></label>
        <label className="field"><span>E-mail (opcional)</span><input className="input" type="email" value={f.email} onChange={set('email')} autoComplete="off" /></label>
        <label className="field"><span>Observação (opcional)</span><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} maxLength={500} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Contacts() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [form, setForm] = useState(params.get('novo') ? {} : null);
  const [confirmDel, setConfirmDel] = useState(null);

  const load = useCallback(() => {
    const t = setTimeout(() => {
      api.get(`/contacts?q=${encodeURIComponent(q)}`).then(setData).catch((e) => toast(e.message, 'error'));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, toast]);
  useEffect(load, [load]);

  const closeForm = () => { setForm(null); if (params.get('novo')) setParams({}, { replace: true }); };

  async function remove(c) {
    setConfirmDel(null);
    try {
      await api.del(`/contacts/${c.id}`);
      toast('Cliente excluído.');
      setData((d) => ({ ...d, total: d.total - 1, contacts: d.contacts.filter((x) => x.id !== c.id) }));
    } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <>
      <header className="page-head head-row">
        <div>
          <h1>Clientes</h1>
          <p className="muted">{data ? `${plural(data.total, 'cliente cadastrado', 'clientes cadastrados')}. ` : ''}Salve uma vez e escolha rápido nas cobranças e lembretes.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setForm({})}><Icon name="plus" size={18} /> Novo cliente</button>
      </header>

      <div className="search-box search-wide">
        <Icon name="search" size={18} />
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, telefone ou e-mail" aria-label="Buscar cliente" />
      </div>

      {data === null ? <p className="muted">Carregando...</p> : data.contacts.length === 0 ? (
        <section className="empty-hero">
          <span className="action-icon action-icon-lg"><Icon name="user" size={32} /></span>
          <h2>{q ? 'Nenhum cliente encontrado' : 'Cadastre seu primeiro cliente'}</h2>
          <p>{q ? 'Tente buscar por outro nome ou número.' : 'Com os clientes salvos, criar uma cobrança leva poucos cliques.'}</p>
          {!q && <button className="btn btn-primary" onClick={() => setForm({})}>Novo cliente</button>}
        </section>
      ) : (
        <ul className="contact-grid">
          {data.contacts.map((c) => (
            <li key={c.id} className="contact-card">
              <span className="avatar">{initials(c.name)}</span>
              <div className="contact-info">
                <strong title={c.name}>{c.name}</strong>
                <span>{formatStoredPhone(c.phone)}</span>
                {c.email && <span className="muted small">{c.email}</span>}
                <span className="tag">{plural(c.scheduleCount, 'cobrança/lembrete', 'cobranças/lembretes')}</span>
              </div>
              <div className="contact-actions">
                <Link className="btn btn-ghost btn-sm" to={`/cobrancas/nova?cliente=${c.id}`}>Cobrar</Link>
                <button className="icon-btn" onClick={() => setForm(c)} aria-label={`Editar ${c.name}`} title="Editar"><Icon name="edit" size={18} /></button>
                <button className="icon-btn icon-btn-danger" onClick={() => setConfirmDel(c)} aria-label={`Excluir ${c.name}`} title="Excluir"><Icon name="trash" size={18} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {form && <ContactForm initial={form.id ? form : null} onClose={closeForm} onSaved={() => { closeForm(); load(); }} />}

      {confirmDel && (
        <Modal title="Excluir este cliente?" onClose={() => setConfirmDel(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>Cancelar</button><button className="btn btn-danger" onClick={() => remove(confirmDel)}>Excluir</button></>}>
          <p><strong>{confirmDel.name}</strong> será removido.{' '}
            {confirmDel.scheduleCount > 0 ? `As ${plural(confirmDel.scheduleCount, 'cobrança/lembrete', 'cobranças/lembretes')} deste cliente também serão apagadas.` : 'Ele não tem cobranças nem lembretes.'}</p>
        </Modal>
      )}
    </>
  );
}
