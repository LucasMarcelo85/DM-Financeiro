import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import Stars from './Stars.jsx';
import { useToast } from './Toast.jsx';
import { addDaysISO, brl, initials, isoToBR, plural, todayISO } from '../lib/format.js';
import { STAR_LEGEND, bucketSeries, clientHabit, lateClass, lateShort, starsText } from '../lib/billing.js';

const PERIODS = [30, 60, 90];

// Faturamento (30/60/90 dias ou por datas), recebimentos e a nota de pontualidade de cada cliente.
export default function BillingDashboard({ version, clients, onUndo }) {
  const toast = useToast();
  const [mode, setMode] = useState(30); // 30 | 60 | 90 | 'datas'
  const [from, setFrom] = useState(() => addDaysISO(todayISO(), -29));
  const [to, setTo] = useState(() => todayISO());
  const [data, setData] = useState(null);
  const [order, setOrder] = useState('piores');

  const rangeError = mode !== 'datas' ? null : !from || !to ? 'Escolha a data inicial e a final.' : from > to ? 'A data inicial não pode ser depois da final.' : null;
  const query = mode === 'datas' ? `from=${from}&to=${to}` : `days=${mode}`;

  useEffect(() => {
    if (rangeError) return undefined;
    let alive = true;
    api.get(`/receipts/summary?${query}`).then((r) => alive && setData(r)).catch((e) => alive && toast(e.message, 'error'));
    return () => { alive = false; };
  }, [query, rangeError, version, toast]);

  const buckets = useMemo(() => (data ? bucketSeries(data.series, data.range.from, data.range.to) : []), [data]);
  const max = Math.max(1, ...buckets.map((b) => b.cents));
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));

  const sortedClients = useMemo(() => {
    if (!clients) return null;
    return order === 'piores' ? clients : [...clients].reverse();
  }, [clients, order]);

  const shown = data && !rangeError ? data : null;
  const title = mode === 'datas' ? 'Faturamento no período escolhido' : `Faturamento dos últimos ${mode} dias`;

  return (
    <>
      <section className="stats-grid" aria-label="Faturamento por período">
        {PERIODS.map((d) => (
          <button key={d} type="button" className={`stat-card fat-card ${mode === d ? 'is-on' : ''}`} aria-pressed={mode === d} onClick={() => setMode(d)}>
            <span className="stat-icon"><Icon name="trend" size={22} /></span>
            <span className="stat-label">Últimos {d} dias</span>
            <strong className="stat-value">{data ? brl(data.periods[d].totalCents) : '–'}</strong>
            <span className="stat-sub">{data ? plural(data.periods[d].count, 'pagamento', 'pagamentos') : ' '}</span>
          </button>
        ))}
        <div className={`stat-card fat-card ${mode === 'datas' ? 'is-on' : ''}`}>
          <span className="stat-icon"><Icon name="calendar" size={22} /></span>
          <span className="stat-label">Por data</span>
          <div className="fat-range">
            <label><span>De</span><input className="input input-sm" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setMode('datas'); }} aria-label="Data inicial" /></label>
            <label><span>Até</span><input className="input input-sm" type="date" value={to} onChange={(e) => { setTo(e.target.value); setMode('datas'); }} aria-label="Data final" /></label>
          </div>
          <span className="stat-sub">{mode === 'datas' && shown ? `${brl(shown.totalCents)} no período` : 'Escolha o período'}</span>
        </div>
      </section>

      <section className="card">
        {rangeError ? <p className="form-error">{rangeError}</p> : !shown ? <p className="muted">Carregando...</p> : (
          <>
            <div className="fat-head">
              <div>
                <h2>{title}</h2>
                <p className="muted small">De {isoToBR(shown.range.from)} até {isoToBR(shown.range.to)} · pelo dia em que o cliente pagou</p>
              </div>
              <strong className="fat-total">{brl(shown.totalCents)}</strong>
            </div>
            {shown.count === 0 ? (
              <p className="empty">Nenhum pagamento marcado neste período. Na lista de cobranças, use o botão <Icon name="check" size={16} /> para marcar como paga.</p>
            ) : (
              <>
                <p className="muted small">{plural(shown.count, 'pagamento recebido', 'pagamentos recebidos')} · média de {brl(shown.averageCents)} por pagamento</p>
                <div className="bars" role="img" aria-label={`Gráfico do faturamento: ${brl(shown.totalCents)} no período`}>
                  {buckets.map((b, i) => (
                    <div key={b.key} className="bar" title={`${b.title}: ${brl(b.cents)}`}>
                      <span className="bar-track"><i style={{ height: `${b.cents ? Math.max(4, (b.cents / max) * 100) : 0}%` }} /></span>
                      <span className="bar-label">{i % labelEvery === 0 ? b.label : ''}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </section>

      {shown && shown.count > 0 && (
        <section className="card">
          <h2 className="card-title">Pagamentos recebidos</h2>
          <ul className="history recv">
            {shown.items.map((p) => (
              <li key={p.id}>
                <span className="history-main">
                  <strong>{p.contactName}</strong> · {brl(p.amountCents)} <span className="muted small">venc. {isoToBR(p.dueDate)}</span>
                </span>
                <span className={`pill ${lateClass(p.lateDays)}`}>{lateShort(p.lateDays)}</span>
                <time>pago em {isoToBR(p.paidAt)}</time>
                <button className="link-btn" onClick={() => onUndo(p)}>Desfazer</button>
              </li>
            ))}
          </ul>
          {shown.hasMore && <p className="muted small">Mostrando os {shown.items.length} mais recentes do período.</p>}
        </section>
      )}

      <section className="card">
        <div className="fat-head">
          <div>
            <h2>Como cada cliente paga</h2>
            <p className="muted small">Nota pela média de atraso nos últimos pagamentos marcados como pagos.</p>
          </div>
          <div className="seg seg-view" role="radiogroup" aria-label="Ordem dos clientes">
            <button role="radio" aria-checked={order === 'piores'} className={order === 'piores' ? 'is-on' : ''} onClick={() => setOrder('piores')}>Mais atrasam</button>
            <button role="radio" aria-checked={order === 'melhores'} className={order === 'melhores' ? 'is-on' : ''} onClick={() => setOrder('melhores')}>Melhores</button>
          </div>
        </div>

        <ul className="star-legend" aria-label="Como ler as estrelas">
          {STAR_LEGEND.map((l) => <li key={l.stars}><Stars value={l.stars} size={14} /> {l.text}</li>)}
        </ul>

        {sortedClients === null ? <p className="muted">Carregando...</p> : sortedClients.length === 0 ? (
          <p className="empty">Quando você marcar cobranças como pagas, aqui aparece como cada cliente costuma pagar.</p>
        ) : (
          <ul className="client-rows">
            {sortedClients.map((c) => (
              <li key={c.contactId} className="client-row">
                <span className="avatar avatar-sm">{initials(c.name)}</span>
                <div className="client-main">
                  <strong>{c.name}</strong>
                  <span className="muted small">{clientHabit(c)} · {plural(c.count, 'pagamento', 'pagamentos')}</span>
                </div>
                <div className="client-rate">
                  <Stars value={c.stars} />
                  <span className="muted small">{starsText(c.stars)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
