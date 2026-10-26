import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { brl, centsToMasked, maskMoney, moneyToCents, plural } from '../lib/format.js';
import { PLAN_TABS, tabLabel } from '../lib/pin.js';

// Gerir planos: o administrador cria, edita e exclui planos (valor mensal e o que cada um oferece). Fica no banco, não no .env.
const FIELDS = [
  ['instances', 'WhatsApps para cobranças e lembretes'],
  ['auditInstances', 'Números na auditoria'],
  ['contracts', 'Modelos de contrato'],
  ['portfolios', 'Páginas de portfólio'],
  ['catalogProducts', 'Quantidade de produtos/serviços que o usuário pode criar (0 = sem catálogo digital)'],
];
const TRIAL_FIELDS = [
  ['days', 'Dias do teste grátis para novos usuários'],
  ...FIELDS,
];

const toForm = (p) => ({
  id: p.id || '', name: p.name || '', color: p.color || '#6f7c8c', sortOrder: String(p.sortOrder ?? ''), price: centsToMasked(p.priceCents ?? 0),
  instances: String(p.instances ?? 1), auditInstances: String(p.auditInstances ?? 1), contracts: String(p.contracts ?? 2), portfolios: String(p.portfolios ?? 1), catalogProducts: String(p.catalogProducts ?? 0), auditSend: Boolean(p.auditSend),
  tabs: (p.tabs || PLAN_TABS).join(','),
});
const SAME = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);

// Valida o formulário e monta o que o servidor espera. Devolve { body } ou { error }.
function toBody(form) {
  const cents = moneyToCents(form.price);
  if (form.name.trim().length < 2) return { error: 'Dê um nome ao plano.' };
  if (cents < 100) return { error: 'O valor mensal precisa ser de pelo menos R$ 1,00.' };
  for (const [k, label] of FIELDS) if (!/^\d+$/.test(form[k].trim())) return { error: `${label}: informe um número inteiro (0 ou mais).` };
  if (form.sortOrder !== '' && !/^\d+$/.test(form.sortOrder.trim())) return { error: 'Ordem: informe um número inteiro.' };
  return {
    body: {
      name: form.name.trim(), color: form.color, sortOrder: form.sortOrder === '' ? 0 : Number(form.sortOrder), priceCents: cents,
      instances: Number(form.instances), auditInstances: Number(form.auditInstances), contracts: Number(form.contracts), portfolios: Number(form.portfolios),
      catalogProducts: Number(form.catalogProducts), auditSend: form.auditSend, tabs: form.tabs ? form.tabs.split(',') : [],
    },
  };
}

const hasTab = (csv, key) => csv.split(',').includes(key);
const toggleTab = (csv, key) => PLAN_TABS.filter((t) => (t === key ? !hasTab(csv, key) : csv.split(',').includes(t))).join(',');

function PlanFields({ form, setForm, withId }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const cents = moneyToCents(form.price);
  return (
    <>
      {withId && (
        <label className="field">
          <span>Identificador (não muda depois)</span>
          <input className="input" value={form.id} onChange={(e) => setForm((f) => ({ ...f, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} maxLength={30} placeholder="ex.: diamante" />
          <small>De 2 a 30 letras minúsculas, números ou hífen.</small>
        </label>
      )}
      <div className="grid-2">
        <label className="field"><span>Nome do plano</span><input className="input" value={form.name} onChange={set('name')} maxLength={40} /></label>
        <label className="field"><span>Cor da etiqueta</span><input className="input input-color" type="color" value={form.color} onChange={set('color')} aria-label="Cor da etiqueta" /></label>
      </div>
      <div className="grid-2">
        <label className="field">
          <span>Valor mensal</span>
          <input className="input" inputMode="numeric" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: maskMoney(e.target.value) }))} />
          <small>Semestral (paga 5 de 6 meses): {brl(cents * 5)} · Anual (paga 9 de 12): {brl(cents * 9)}</small>
        </label>
        <label className="field"><span>Ordem na lista</span><input className="input" inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value.replace(/\D/g, '').slice(0, 4) }))} /></label>
      </div>
      {FIELDS.map(([k, label]) => (
        <label key={k} className="field">
          <span>{label}</span>
          <input className="input" inputMode="numeric" value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value.replace(/\D/g, '').slice(0, 6) }))} />
        </label>
      ))}
      <label className="check-line"><input type="checkbox" checked={form.auditSend} onChange={(e) => setForm((f) => ({ ...f, auditSend: e.target.checked }))} /> Pode responder conversas pela auditoria</label>
      <fieldset className="field">
        <legend>Abas visíveis para o usuário deste plano</legend>
        <div className="pin-tabs">
          {PLAN_TABS.map((key) => {
            const on = hasTab(form.tabs, key);
            const toggle = () => setForm((f) => ({ ...f, tabs: toggleTab(f.tabs, key) }));
            return (
              <label key={key} className={`pin-tab ${on ? 'is-on' : ''}`}>
                <input type="checkbox" checked={on} onChange={toggle} />
                {tabLabel(key)}
              </label>
            );
          })}
        </div>
        <small>Início, Plano e Perfil aparecem sempre. Produtos e Pedidos também exigem o limite de produtos/serviços acima maior que 0.</small>
      </fieldset>
    </>
  );
}

export default function AdminPlans() {
  const toast = useToast();
  const [plans, setPlans] = useState(null);
  const [trial, setTrial] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(() => {
    api.get('/admin/plans').then((r) => { setPlans(r.plans); setTrial(r.trial || null); }).catch((e) => toast(e.message, 'error'));
  }, [toast]);
  useEffect(load, [load]);

  return (
    <>
      <header className="page-head head-row">
        <div>
          <h1>Planos</h1>
          <p className="muted">Crie, altere e exclua planos: valor mensal e o que cada um oferece. As mudanças valem na hora para novos pagamentos e para os limites de uso.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={18} /> Novo plano</button>
      </header>
      {plans === null ? <p className="muted">Carregando...</p> : (
        <>
          {trial && <TrialEditor trial={trial} onSaved={(nextPlans, nextTrial) => { setPlans(nextPlans); setTrial(nextTrial); }} />}
          <div className="plans-admin">
            {plans.map((p) => <PlanEditor key={`${p.id}:${p.name}`} plan={p} onSaved={(nextPlans) => setPlans(nextPlans)} onDelete={() => setDeleting(p)} canDelete={plans.length > 1} />)}
          </div>
        </>
      )}
      {creating && <NewPlan count={plans?.length || 0} onClose={() => setCreating(false)} onCreated={(list) => { setPlans(list); setCreating(false); }} />}
      {deleting && <DeletePlan plan={deleting} plans={plans} onClose={() => setDeleting(null)} onDeleted={(list) => { setPlans(list); setDeleting(null); }} />}
    </>
  );
}

function PlanEditor({ plan, onSaved, onDelete, canDelete }) {
  const toast = useToast();
  const [form, setForm] = useState(() => toForm(plan));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = !SAME(form, toForm(plan));

  async function save(e) {
    e.preventDefault();
    setError('');
    const r = toBody(form);
    if (r.error) return setError(r.error);
    setBusy(true);
    try {
      const res = await api.put(`/admin/plans/${plan.id}`, r.body);
      onSaved(res.plans);
      toast(`Plano ${r.body.name} atualizado.`);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <form className="card form plan-editor" onSubmit={save} noValidate style={{ borderTop: `6px solid ${form.color}` }}>
      <div className="plan-editor-head">
        <h2 className="card-title"><span className="badge" style={{ background: form.color }}>{form.name || plan.id}</span></h2>
        <small className="muted">{plural(plan.userCount, 'usuário', 'usuários')}</small>
      </div>
      <PlanFields form={form} setForm={setForm} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="btn-row">
        <button className="btn btn-primary" disabled={busy || !dirty}>{busy ? 'Salvando...' : 'Salvar plano'}</button>
        <button type="button" className="btn btn-ghost btn-danger-text" onClick={onDelete} disabled={!canDelete} title={canDelete ? 'Excluir este plano' : 'Sempre deve existir pelo menos um plano'}><Icon name="trash" size={16} /> Excluir</button>
      </div>
    </form>
  );
}

function TrialEditor({ trial, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => ({ ...toForm({ ...trial, id: 'trial', name: 'Teste grátis', color: '#4b5563', sortOrder: 0, priceCents: 0 }), days: String(trial.days ?? 3) }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm({ ...toForm({ ...trial, id: 'trial', name: 'Teste grátis', color: '#4b5563', sortOrder: 0, priceCents: 0 }), days: String(trial.days ?? 3) });
  }, [trial]);

  const dirty = form.days !== String(trial.days ?? 3)
    || FIELDS.some(([k]) => form[k] !== String(trial[k] ?? 0))
    || form.auditSend !== Boolean(trial.auditSend)
    || form.tabs !== (trial.tabs || PLAN_TABS).join(',');

  async function save(e) {
    e.preventDefault();
    setError('');
    for (const [k, label] of TRIAL_FIELDS) {
      if (!/^\d+$/.test(form[k].trim())) return setError(`${label}: informe um número inteiro (0 ou mais).`);
    }
    const days = Number(form.days);
    if (days < 1 || days > 60) return setError('Dias do teste grátis: informe um número de 1 a 60.');
    setBusy(true);
    try {
      const res = await api.put('/admin/trial', {
        days,
        instances: Number(form.instances),
        auditInstances: Number(form.auditInstances),
        contracts: Number(form.contracts),
        portfolios: Number(form.portfolios),
        catalogProducts: Number(form.catalogProducts),
        auditSend: form.auditSend,
        tabs: form.tabs ? form.tabs.split(',') : [],
      });
      toast('Teste grátis atualizado.');
      onSaved(res.plans, res.trial);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form plan-editor" onSubmit={save} noValidate style={{ borderTop: '6px solid #4b5563' }}>
      <div className="plan-editor-head">
        <h2 className="card-title"><span className="badge" style={{ background: '#4b5563' }}>Teste grátis</span></h2>
        <small className="muted">Configura novos usuários em teste</small>
      </div>
      {TRIAL_FIELDS.map(([k, label]) => (
        <label key={k} className="field">
          <span>{label}</span>
          <input className="input" inputMode="numeric" value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value.replace(/\D/g, '').slice(0, 6) }))} />
        </label>
      ))}
      <label className="check-line"><input type="checkbox" checked={form.auditSend} onChange={(e) => setForm((f) => ({ ...f, auditSend: e.target.checked }))} /> Pode responder conversas pela auditoria</label>
      <fieldset className="field">
        <legend>Abas visíveis durante o teste grátis</legend>
        <div className="pin-tabs">
          {PLAN_TABS.map((key) => {
            const on = hasTab(form.tabs, key);
            return (
              <label key={key} className={`pin-tab ${on ? 'is-on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => setForm((f) => ({ ...f, tabs: toggleTab(f.tabs, key) }))} />
                {tabLabel(key)}
              </label>
            );
          })}
        </div>
        <small>Essas abas e limites valem só no período de teste. Depois, o usuário passa a usar os limites do plano contratado.</small>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="btn-row">
        <button className="btn btn-primary" disabled={busy || !dirty}>{busy ? 'Salvando...' : 'Salvar teste grátis'}</button>
      </div>
    </form>
  );
}

function NewPlan({ count, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(() => toForm({ sortOrder: count + 1, priceCents: 9990, instances: 3, auditInstances: 5, contracts: 20, portfolios: 7, catalogProducts: 120, auditSend: true, color: '#3b82f6' }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setError('');
    if (!/^[a-z0-9][a-z0-9-]{1,29}$/.test(form.id)) return setError('Identificador inválido. Use de 2 a 30 letras minúsculas, números ou hífen.');
    const r = toBody(form);
    if (r.error) return setError(r.error);
    setBusy(true);
    try {
      const res = await api.post('/admin/plans', { id: form.id, ...r.body });
      toast(`Plano ${r.body.name} criado.`);
      onCreated(res.plans);
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <Modal title="Novo plano" onClose={busy ? () => {} : onClose} wide
      footer={<><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn btn-primary" onClick={create} disabled={busy}>{busy ? 'Criando...' : 'Criar plano'}</button></>}>
      <div className="form"><PlanFields form={form} setForm={setForm} withId />{error && <p className="form-error" role="alert">{error}</p>}</div>
    </Modal>
  );
}

function DeletePlan({ plan, plans, onClose, onDeleted }) {
  const toast = useToast();
  const others = plans.filter((p) => p.id !== plan.id);
  const [moveTo, setMoveTo] = useState(others[0]?.id || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true); setError('');
    try {
      const r = await api.del(`/admin/plans/${plan.id}`, plan.userCount > 0 ? { moveTo } : {});
      toast(`Plano ${r.removed} excluído${r.moved ? ` e ${plural(r.moved, 'usuário passou', 'usuários passaram')} para outro plano` : ''}.`);
      onDeleted(r.plans);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  return (
    <Modal title={`Excluir o plano ${plan.name}?`} onClose={busy ? () => {} : onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn btn-danger" onClick={remove} disabled={busy || (plan.userCount > 0 && !moveTo)}>{busy ? 'Excluindo...' : 'Excluir plano'}</button></>}>
      {plan.userCount > 0 ? (
        <>
          <p>Este plano tem <strong>{plural(plan.userCount, 'usuário', 'usuários')}</strong>. Escolha para qual plano eles passam (o acesso e as datas de pagamento não mudam):</p>
          <label className="field"><span>Mover usuários para</span>
            <select className="input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>{others.map((p) => <option key={p.id} value={p.id}>{p.name} — {brl(p.priceCents)}/mês</option>)}</select>
          </label>
        </>
      ) : <p>Nenhum usuário está neste plano. Ele deixa de aparecer na tela de planos e no cadastro. Não dá para desfazer.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}
