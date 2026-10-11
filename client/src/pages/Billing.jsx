import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import PlanBadge from '../components/PlanBadge.jsx';
import { brl, dateBR, plural } from '../lib/format.js';

export default function Billing() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [plan, setPlan] = useState(user.plan);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/billing').then(setData).catch((e) => toast(e.message, 'error'));
  }, [toast]);

  async function pay() {
    setBusy(true);
    try {
      const { url } = await api.post('/billing/checkout', { plan });
      window.location.assign(url);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  const access = data?.access || user.access;
  const chosen = data?.plans.find((p) => p.id === plan);
  const isAdmin = user.role === 'admin';

  const headline = {
    admin: 'Conta de administrador',
    paid: `Acesso ativo até ${dateBR(access.endsAt)}`,
    trial: `Teste grátis até ${dateBR(access.endsAt)}`,
    expired: 'Seu teste grátis terminou',
  }[access.status];

  return (
    <>
      <header className="page-head">
        <h1>Plano e pagamento</h1>
        <p className="muted">Pague pelo link da InfinitePay e continue usando normalmente.</p>
      </header>

      <section className={`banner ${access.status === 'expired' ? 'banner-red' : access.status === 'trial' ? 'banner-amber' : 'banner-green'}`}>
        <div>
          <strong>{headline}</strong>
          <span>
            {access.status === 'expired' && 'Escolha um plano abaixo e pague para voltar a enviar cobranças e lembretes.'}
            {access.status === 'trial' && `${plural(access.daysLeft, 'dia restante', 'dias restantes')}. Você pode pagar a qualquer momento: os dias que sobrarem são somados.`}
            {access.status === 'paid' && `${plural(access.daysLeft, 'dia restante', 'dias restantes')}. Renove quando quiser: os dias que sobrarem são somados.`}
            {access.status === 'admin' && 'Administradores não são cobrados.'}
          </span>
        </div>
      </section>

      {!isAdmin && data && (
        <>
          <section className="plans" role="radiogroup" aria-label="Escolha seu plano">
            {data.plans.map((p) => (
              <label key={p.id} className={`plan-card plan-card-${p.id} ${plan === p.id ? 'is-on' : ''}`}>
                <input type="radio" name="plan" value={p.id} checked={plan === p.id} onChange={() => setPlan(p.id)} />
                <span className="plan-card-head">
                  <PlanBadge plan={p.id} />
                  {user.plan === p.id && <small>Seu plano</small>}
                </span>
                <span className="plan-price">{brl(p.priceCents)}<small>/mês</small></span>
                <ul>
                  <li>{plural(p.instances, 'WhatsApp conectado', 'WhatsApps conectados')}</li>
                  <li>{plural(p.contracts, 'modelo de contrato', 'modelos de contrato')}</li>
                  <li>Cobranças e lembretes</li>
                </ul>
              </label>
            ))}
          </section>

          <section className="card pay-box">
            <div>
              <h2 className="card-title">Pagar plano {chosen?.name}</h2>
              <p className="muted">
                Você vai para a página segura da InfinitePay e volta aqui automaticamente. O pagamento libera {plural(data.accessDays, 'dia', 'dias')} de acesso.
              </p>
              {!data.paymentsConfigured && <p className="form-error">O pagamento ainda não foi configurado pelo administrador.</p>}
            </div>
            <button className="btn btn-primary" onClick={pay} disabled={busy || !data.paymentsConfigured}>
              {busy ? 'Abrindo pagamento...' : `Pagar ${chosen ? brl(chosen.priceCents) : ''}`}
            </button>
          </section>

          {data.payments.length > 0 && (
            <section className="card">
              <h2 className="card-title">Pagamentos</h2>
              <ul className="history">
                {data.payments.map((p) => (
                  <li key={p.id}>
                    <span className="history-main">Plano {p.plan} · {brl(p.amountCents)}</span>
                    <span className={`pill ${p.status === 'paid' ? 'pill-sent' : 'pill-partial'}`}>{p.status === 'paid' ? 'Pago' : 'Aguardando'}</span>
                    <time>{dateBR(p.paidAt || p.createdAt)}</time>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
