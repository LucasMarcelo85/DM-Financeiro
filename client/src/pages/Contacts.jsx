import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import CsvTransfer from '../components/CsvTransfer.jsx';
import { useToast } from '../components/Toast.jsx';
import { importCsvBatches } from '../lib/csv.js';
import { digits, formatStoredPhone, initials, maskCNPJ, maskCPF, maskPhone, plural } from '../lib/format.js';

const maskAnyDoc = (v) => (digits(v).length > 11 ? maskCNPJ(v) : maskCPF(v));
const maskCEP = (v) => { const d = digits(v).slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
const EXTRA = ['document', 'zip', 'street', 'number', 'complement', 'district', 'city', 'state'];
const CONTACT_CSV_COLUMNS = [
  { key: 'name', type: 'string' }, { key: 'phone', type: 'string' }, { key: 'email', type: 'string' },
  { key: 'notes', type: 'string' }, { key: 'document', type: 'string' }, { key: 'zip', type: 'string' },
  { key: 'street', type: 'string' }, { key: 'number', type: 'string' }, { key: 'complement', type: 'string' },
  { key: 'district', type: 'string' }, { key: 'city', type: 'string' }, { key: 'state', type: 'string' },
  { key: 'createdAt', type: 'date' },
];

function ContactForm({ initial, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: initial?.name || '', phone: initial?.phone ? formatStoredPhone(initial.phone) : '', email: initial?.email || '', notes: initial?.notes || '',
    document: initial?.document ? maskAnyDoc(initial.document) : '', zip: initial?.zip ? maskCEP(initial.zip) : '',
    street: initial?.street || '', number: initial?.number || '', complement: initial?.complement || '', district: initial?.district || '', city: initial?.city || '', state: initial?.state || '',
  });
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
        <details className="contact-extra" open={EXTRA.some((k) => initial?.[k])}>
          <summary>Dados para contratos <small>(opcional)</small></summary>
          <p className="muted small">Esses dados viram variáveis nos contratos, como {'{{cliente.documento}}'} e {'{{cliente.endereco}}'}.</p>
          <label className="field"><span>CPF ou CNPJ</span><input className="input" inputMode="numeric" value={f.document} onChange={(e) => setF((x) => ({ ...x, document: maskAnyDoc(e.target.value) }))} placeholder="000.000.000-00" autoComplete="off" /></label>
          <div className="field-row">
            <label className="field"><span>CEP</span><input className="input" inputMode="numeric" value={f.zip} onChange={(e) => setF((x) => ({ ...x, zip: maskCEP(e.target.value) }))} placeholder="00000-000" autoComplete="off" /></label>
            <label className="field"><span>Estado (UF)</span><input className="input" value={f.state} onChange={(e) => setF((x) => ({ ...x, state: e.target.value.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase() }))} placeholder="CE" autoComplete="off" /></label>
          </div>
          <label className="field"><span>Rua</span><input className="input" value={f.street} onChange={set('street')} maxLength={120} autoComplete="off" /></label>
          <div className="field-row">
            <label className="field"><span>Número</span><input className="input" value={f.number} onChange={set('number')} maxLength={20} autoComplete="off" /></label>
            <label className="field"><span>Complemento</span><input className="input" value={f.complement} onChange={set('complement')} maxLength={80} autoComplete="off" /></label>
          </div>
          <div className="field-row">
            <label className="field"><span>Bairro</span><input className="input" value={f.district} onChange={set('district')} maxLength={80} autoComplete="off" /></label>
            <label className="field"><span>Cidade</span><input className="input" value={f.city} onChange={set('city')} maxLength={80} autoComplete="off" /></label>
          </div>
        </details>
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
        <div className="btn-group">
          <CsvTransfer
            resource="contacts" title="clientes" filename="clientes.csv" exportUrl="/contacts/export"
            columns={CONTACT_CSV_COLUMNS}
            description="Exporte os dados cadastrais completos, incluindo contatos, documentos e endereço."
            onImport={async (contacts) => {
              const result = await importCsvBatches(contacts, (batch) => api.post('/contacts/import', { contacts: batch }), 500, 2 * 1024 * 1024);
              load();
              return result;
            }}
          />
          <button className="btn btn-primary" onClick={() => setForm({})}><Icon name="plus" size={18} /> Novo cliente</button>
        </div>
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
