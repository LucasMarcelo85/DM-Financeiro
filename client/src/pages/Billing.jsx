import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import PlanCards, { PeriodToggle } from '../components/PlanCards.jsx';
import { brl, dateBR, plural } from '../lib/format.js';

export default function Billing() {
  const { user } = useAuth();
  const toast = useToast();
  const [search] = useSearchParams();
  const focus = search.get('extra') || '';
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
            {access.status === 'expired' && `Escolha um plano abaixo e pague para voltar a enviar cobranças e lembretes.${access.deleteInDays != null ? ` Sua conta e seus dados serão apagados em ${plural(access.deleteInDays, 'dia', 'dias')}.` : ''}`}
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

          <AddonsBox addons={data.addons} paymentsConfigured={data.paymentsConfigured} focus={focus} />

          {data.payments.length > 0 && (
            <section className="card">
              <h2 className="card-title">Pagamentos</h2>
              <ul className="history">
                {data.payments.map((p) => (
                  <li key={p.id}>
                    <span className="history-main">{p.kind === 'addon' ? 'Limites extras' : `Plano ${p.plan} · ${p.period || 'mensal'}`} · {brl(p.amountCents)}</span>
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

const WARN_DAYS = 7;

function AddonsBox({ addons, paymentsConfigured, focus }) {
  const toast = useToast();
  const ref = useRef(null);
  const [packs, setPacks] = useState({});
  const [busy, setBusy] = useState(false);
  const { settings, purchases, extras } = addons;

  useEffect(() => { if (focus) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [focus]);

  async function checkout(items) {
    setBusy(true);
    try {
      const { url } = await api.post('/billing/addons/checkout', { items });
      window.location.assign(url);
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  }

  const cart = settings.filter((s) => Number(packs[s.resource]) > 0).map((s) => ({ resource: s.resource, packs: Number(packs[s.resource]) }));
  const cartTotal = cart.reduce((sum, it) => sum + it.packs * settings.find((s) => s.resource === it.resource).priceCents, 0);
  const expiring = purchases.filter((p) => !p.active || p.daysLeft <= WARN_DAYS);
  const priceOf = (p) => { const s = settings.find((x) => x.resource === p.resource); return s ? Math.max(1, Math.round(p.units / s.packUnits)) * s.priceCents : 0; };
  const renewTotal = expiring.reduce((sum, p) => sum + priceOf(p), 0);

  if (!settings.length && !purchases.length) return null;
  return (
    <section className="card" ref={ref} id="extras">
      <h2 className="card-title">Limites extras</h2>
      <p className="muted">Precisa de mais do que o plano oferece? Adquira pacotes por {addons.days} dias. Se não renovar, os limites voltam ao do plano contratado e o que foi criado acima dele fica bloqueado.</p>

      {purchases.length > 0 && (
        <>
          {expiring.length > 0 && (
            <div className="banner banner-amber">
              <div>
                <strong>{expiring.some((p) => !p.active) ? 'Há limites extras vencidos ou perto de vencer' : 'Limites extras perto de vencer'}</strong>
                <span>Pague antes do vencimento para não perder as configurações feitas com o limite aumentado.</span>
              </div>
              {paymentsConfigured && renewTotal >= 1 && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => checkout(expiring.map((p) => ({ addonId: p.id })))}>Renovar tudo · {brl(renewTotal)}</button>}
            </div>
          )}
          <ul className="history">
            {purchases.map((p) => (
              <li key={p.id}>
                <span className="history-main">+{p.units} {p.label}</span>
                <span className={`pill ${p.active ? (p.daysLeft <= WARN_DAYS ? 'pill-partial' : 'pill-sent') : 'pill-failed'}`}>{p.active ? `${plural(p.daysLeft, 'dia', 'dias')}` : 'Vencido'}</span>
                <time>{dateBR(p.paidUntil)}</time>
                {paymentsConfigured && priceOf(p) >= 1 && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => checkout([{ addonId: p.id }])}>Pagar antecipado · {brl(priceOf(p))}</button>}
              </li>
            ))}
          </ul>
        </>
      )}

      {settings.length > 0 && (
        <div className="form">
          {settings.map((s) => (
            <label key={s.resource} className="field" style={s.resource === focus ? { outline: '2px solid var(--primary, #2563eb)', borderRadius: 8, padding: 6 } : undefined}>
              <span>{s.label} — {plural(s.packUnits, s.unit, s.units)} por {brl(s.priceCents)}/mês{extras[s.resource] ? ` (você tem +${extras[s.resource]})` : ''}</span>
              <input className="input" inputMode="numeric" placeholder="Pacotes" value={packs[s.resource] || ''} onChange={(e) => setPacks((p) => ({ ...p, [s.resource]: e.target.value.replace(/\D/g, '').slice(0, 3) }))} />
              <small>{packs[s.resource] ? `+${plural(Number(packs[s.resource]) * s.packUnits, s.unit, s.units)} · ${brl(Number(packs[s.resource]) * s.priceCents)}` : `Até ${s.maxPacks} pacotes por compra`}</small>
            </label>
          ))}
          <div className="btn-row">
            <button className="btn btn-primary" disabled={busy || !paymentsConfigured || !cart.length} onClick={() => checkout(cart)}>{busy ? 'Abrindo pagamento...' : `Adquirir ${cart.length ? brl(cartTotal) : ''}`}</button>
          </div>
        </div>
      )}
    </section>
  );
}
