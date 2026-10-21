import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { brl, centsToMasked, maskMoney, moneyToCents } from '../lib/format.js';

const FIELDS = [
  ['instances', 'WhatsApps para cobranças e lembretes'],
  ['auditInstances', 'Números na auditoria'],
  ['contracts', 'Modelos de contrato'],
  ['portfolios', 'Páginas de portfólio'],
];

const toForm = (p) => ({ price: centsToMasked(p.priceCents), instances: String(p.instances), auditInstances: String(p.auditInstances), contracts: String(p.contracts), portfolios: String(p.portfolios), auditSend: p.auditSend });
const SAME = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);

export default function AdminPlans() {
  const toast = useToast();
  const [plans, setPlans] = useState(null);

  const load = useCallback(() => {
    api.get('/admin/plans').then((r) => setPlans(r.plans)).catch((e) => toast(e.message, 'error'));
  }, [toast]);
  useEffect(load, [load]);

  return (
    <>
      <header className="page-head">
        <h1>Planos</h1>
        <p className="muted">Defina o valor mensal e o que cada plano oferece. As mudanças valem na hora para novos pagamentos e para os limites de uso.</p>
      </header>
      {plans === null ? <p className="muted">Carregando...</p> : (
        <div className="plans-admin">
          {plans.map((p) => <PlanEditor key={p.id} plan={p} onSaved={setPlans} />)}
        </div>
      )}
    </>
  );
}

function PlanEditor({ plan, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState(() => toForm(plan));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = !SAME(form, toForm(plan));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const cents = moneyToCents(form.price);

  async function save(e) {
    e.preventDefault();
    setError('');
    if (cents < 100) return setError('O valor mensal precisa ser de pelo menos R$ 1,00.');
    for (const [k, label] of FIELDS) if (!/^\d+$/.test(form[k].trim())) return setError(`${label}: informe um número inteiro (0 ou mais).`);
    setBusy(true);
    try {
      const r = await api.put(`/admin/plans/${plan.id}`, {
        priceCents: cents,
        instances: Number(form.instances), auditInstances: Number(form.auditInstances), contracts: Number(form.contracts), portfolios: Number(form.portfolios),
        auditSend: form.auditSend,
      });
      onSaved(r.plans);
      const saved = r.plans.find((x) => x.id === plan.id);
      setForm(toForm(saved));
      toast(`Plano ${plan.name} atualizado.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`card form plan-editor plan-editor-${plan.id}`} onSubmit={save} noValidate>
      <div className="plan-editor-head">
        <h2 className="card-title"><span className={`badge plan-${plan.id}`}>{plan.name}</span></h2>
        <small className="muted">{plan.userCount} {plan.userCount === 1 ? 'usuário' : 'usuários'}</small>
      </div>
      <label className="field">
        <span>Valor mensal</span>
        <input className="input" inputMode="numeric" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: maskMoney(e.target.value) }))} />
        <small>Semestral (paga 5 de 6 meses): {brl(cents * 5)} · Anual (paga 9 de 12): {brl(cents * 9)}</small>
      </label>
      {FIELDS.map(([k, label]) => (
        <label key={k} className="field">
          <span>{label}</span>
          <input className="input" inputMode="numeric" value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value.replace(/\D/g, '').slice(0, 5) }))} />
        </label>
      ))}
      <label className="check-line">
        <input type="checkbox" checked={form.auditSend} onChange={(e) => setForm((f) => ({ ...f, auditSend: e.target.checked }))} />
        Pode responder conversas pela auditoria
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn-primary" disabled={busy || !dirty}>{busy ? 'Salvando...' : 'Salvar plano'}</button>
    </form>
  );
}
