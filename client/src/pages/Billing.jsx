import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import PlanCards, { PeriodToggle } from '../components/PlanCards.jsx';
import { brl, dateBR, plural } from '../lib/format.js';

export default function Billing() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [plan, setPlan] = useState(user.plan);
  const [period, setPeriod] = useState('mensal');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/billing').then((d) => {
      setData(d);
      setPlan((cur) => (d.plans.some((p) => p.id === cur) ? cur : (d.plans.find((p) => p.id === 'prata') || d.plans[0])?.id || cur)); // o plano atual pode não existir mais
    }).catch((e) => toast(e.message, 'error'));
  }, [toast]);

  async function pay() {
    setBusy(true);
    try {
      const { url } = await api.post('/billing/checkout', { plan, period });
      window.location.assign(url);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  const access = data?.access || user.access;
  const chosen = data?.plans.find((p) => p.id === plan);
  const chosenPeriod = data?.periods.find((x) => x.id === period);
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
          <PeriodToggle periods={data.periods} value={period} onChange={setPeriod} />
          <PlanCards plans={data.plans} periods={data.periods} period={period} selected={plan} onSelect={setPlan} currentPlan={user.plan} />

          <section className="card pay-box">
            <div>
              <h2 className="card-title">Pagar plano {chosen?.name} · {chosenPeriod?.label.toLowerCase()}</h2>
              <p className="muted">
                Você vai para a página segura da InfinitePay e volta aqui automaticamente. O pagamento {chosenPeriod?.label.toLowerCase()} libera {plural(chosenPeriod?.days ?? data.accessDays, 'dia', 'dias')} de acesso.
              </p>
              {!data.paymentsConfigured && <p className="form-error">O pagamento ainda não foi configurado pelo administrador.</p>}
            </div>
            <button className="btn btn-primary" onClick={pay} disabled={busy || !data.paymentsConfigured}>
              {busy ? 'Abrindo pagamento...' : `Pagar ${chosen ? brl(chosen.prices[period]) : ''}`}
            </button>
          </section>

          {data.payments.length > 0 && (
            <section className="card">
              <h2 className="card-title">Pagamentos</h2>
              <ul className="history">
                {data.payments.map((p) => (
                  <li key={p.id}>
                    <span className="history-main">Plano {p.plan} · {p.period || 'mensal'} · {brl(p.amountCents)}</span>
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
