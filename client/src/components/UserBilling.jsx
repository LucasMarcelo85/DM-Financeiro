import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';
import { useToast } from './Toast.jsx';
import { brl, centsToMasked, dateBR, maskMoney, moneyToCents } from '../lib/format.js';

function Money({ value, onChange, placeholder }) {
  return <input className="input" inputMode="numeric" value={value} placeholder={placeholder} onChange={(e) => onChange(maskMoney(e.target.value))} style={{ maxWidth: 130 }} />;
}

// Painel do admin: o que o usuário paga, o que será cobrado, limites individuais e cobranças (marcar como paga / cancelar).
export default function UserBilling({ user, onClose, onChanged }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [planPrice, setPlanPrice] = useState('');
  const [add, setAdd] = useState({ resource: '', units: '1', days: '30', price: '' });
  const [charge, setCharge] = useState('');
  const base = `/admin/users/${user.id}`;

  const apply = useCallback((d) => {
    setData(d);
    setPlanPrice(d.planCustom ? centsToMasked(d.planMonthlyCents) : '');
    setCharge(centsToMasked(d.nextTotalCents));
    setAdd((a) => ({ ...a, resource: a.resource || d.resources[0]?.key || '' }));
  }, []);

  useEffect(() => { api.get(`${base}/billing`).then(apply).catch((e) => toast(e.message, 'error')); }, [base, apply, toast]);

  async function run(fn, ok) {
    setBusy(true);
    try { apply(await fn()); if (ok) toast(ok, 'success'); onChanged?.(); }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  const priceOrNull = (v) => (v ? moneyToCents(v) : null);

  return (
    <Modal title={`Cobrança e limites · ${user.name}`} onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Fechar</button>}>
      {!data ? <p className="muted">Carregando…</p> : (
        <div className="stack" style={{ gap: 18 }}>
          <section>
            <h4>Valores</h4>
            <p>Plano <strong>{data.planName}</strong>: {brl(data.planMonthlyCents)}/mês {data.planCustom ? <span className="muted">(valor combinado; padrão {brl(data.planListCents)})</span> : <span className="muted">(valor padrão)</span>}</p>
            <p>Previsão do próximo mês (plano + limites ativos): <strong>{brl(data.nextTotalCents)}</strong></p>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Money value={planPrice} onChange={setPlanPrice} placeholder="R$ 0,00" />
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.put(`${base}/plan-price`, { priceCents: priceOrNull(planPrice) }), 'Valor do plano salvo.')}>Alterar valor do plano</button>
              {data.planCustom && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.put(`${base}/plan-price`, { priceCents: null }), 'Voltou ao valor padrão.')}>Usar padrão</button>}
            </div>
          </section>

          <section>
            <h4>Limites extras</h4>
            {!data.addons.length && <p className="muted small">Nenhum limite extra.</p>}
            {data.addons.map((a) => <AddonRow key={a.id} a={a} busy={busy} base={base} run={run} />)}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <select className="input" value={add.resource} onChange={(e) => setAdd({ ...add, resource: e.target.value })} style={{ maxWidth: 220 }}>
                {data.resources.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <input className="input" type="number" min="1" value={add.units} onChange={(e) => setAdd({ ...add, units: e.target.value })} style={{ maxWidth: 80 }} title="Quantidade" />
              <input className="input" type="number" min="1" value={add.days} onChange={(e) => setAdd({ ...add, days: e.target.value })} style={{ maxWidth: 80 }} title="Dias de acesso" />
              <Money value={add.price} onChange={(v) => setAdd({ ...add, price: v })} placeholder="Valor/mês" />
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => api.post(`${base}/addons`, { resource: add.resource, units: Number(add.units), days: Number(add.days), priceCents: priceOrNull(add.price) }), 'Limite liberado.')}>Dar limite</button>
            </div>
            <p className="muted small">Quantidade, dias liberados e valor mensal (vazio = valor de "Gerir planos").</p>
          </section>

          <section>
            <h4>Cobranças</h4>
            <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Money value={charge} onChange={setCharge} placeholder="R$ 0,00" />
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.post(`${base}/charges`, { amountCents: moneyToCents(charge) }), 'Cobrança criada.')}>Cobrar plano</button>
            </div>
            {!data.payments.length && <p className="muted small">Nenhuma cobrança.</p>}
            {data.payments.map((p) => (
              <div key={p.id} className="row" style={{ gap: 8, alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border, #e5e5e5)' }}>
                <span>{p.kind === 'addon' ? 'Limite extra' : `Plano ${p.plan}`} · {brl(p.amountCents)} · {dateBR(p.createdAt)} · <strong>{p.status === 'paid' ? `pago ${dateBR(p.paidAt)}` : 'pendente'}</strong></span>
                {p.status === 'pending' && (
                  <span className="row" style={{ gap: 6 }}>
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => api.post(`/admin/payments/${p.id}/mark-paid`), 'Marcada como paga e liberada.')}>Marcar como paga</button>
                    <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.del(`/admin/payments/${p.id}`), 'Cobrança cancelada.')}>Cancelar</button>
                  </span>
                )}
              </div>
            ))}
          </section>
        </div>
      )}
    </Modal>
  );
}

function AddonRow({ a, busy, base, run }) {
  const [units, setUnits] = useState(String(a.units));
  const [price, setPrice] = useState(a.custom ? centsToMasked(a.monthlyCents) : '');
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid var(--border, #e5e5e5)' }}>
      <span style={{ minWidth: 190 }}>{a.label}<br /><small className="muted">{a.active ? `até ${dateBR(a.paidUntil)}` : `vencido em ${dateBR(a.paidUntil)}`} · {brl(a.monthlyCents)}/mês</small></span>
      <input className="input" type="number" min="1" value={units} onChange={(e) => setUnits(e.target.value)} style={{ maxWidth: 80 }} title="Quantidade" />
      <Money value={price} onChange={setPrice} placeholder="Valor/mês" />
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.patch(`${base}/addons/${a.id}`, { units: Number(units), priceCents: price ? moneyToCents(price) : null }), 'Limite atualizado.')}>Salvar</button>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.patch(`${base}/addons/${a.id}`, { addDays: 30 }), '+30 dias.')}>+30 dias</button>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.post(`${base}/charges`, { addonId: a.id, amountCents: a.monthlyCents }), 'Cobrança criada.')}>Cobrar</button>
      <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.del(`${base}/addons/${a.id}`), 'Limite removido.')}>Remover</button>
    </div>
  );
}
