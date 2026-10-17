import PlanBadge from './PlanBadge.jsx';
import { brl } from '../lib/format.js';
import { PERIOD_SUFFIX, planFeatureRows } from '../lib/plans.js';

function Mark({ ok }) {
  return (
    <span className={`pc-mark ${ok ? 'is-yes' : 'is-no'}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        {ok ? <path d="M20 6 9 17l-5-5" /> : <path d="M18 6 6 18M6 6l12 12" />}
      </svg>
    </span>
  );
}

export function PeriodToggle({ periods, value, onChange }) {
  return (
    <div className="pc-periods" role="radiogroup" aria-label="Período de pagamento">
      {periods.map((p) => (
        <label key={p.id} className={value === p.id ? 'is-on' : ''}>
          <input type="radio" name="period" value={p.id} checked={value === p.id} onChange={() => onChange(p.id)} />
          {p.label}
        </label>
      ))}
    </div>
  );
}

// Cards dos planos: valor do período escolhido em destaque, os três valores para comparar e a lista com ✓ / ✗.
export default function PlanCards({ plans, periods, period, selected, onSelect, currentPlan }) {
  return (
    <section className="pc-grid" role="radiogroup" aria-label="Escolha seu plano">
      {plans.map((p) => (
        <label key={p.id} className={`pc pc-${p.id} ${selected === p.id ? 'is-on' : ''}`}>
          <input type="radio" name="plan" value={p.id} checked={selected === p.id} onChange={() => onSelect(p.id)} />
          <span className="pc-head">
            <PlanBadge plan={p.id} />
            {currentPlan === p.id && <small className="pc-current">Seu plano</small>}
          </span>
          <span className="pc-price">
            <b>{brl(p.prices[period])}</b>
            <small>{PERIOD_SUFFIX[period]}</small>
          </span>
          <dl className="pc-compare" aria-label="Valores por período">
            {periods.map((x) => (
              <div key={x.id} className={x.id === period ? 'is-on' : ''}>
                <dt>{x.label}</dt>
                <dd>{brl(p.prices[x.id])}</dd>
              </div>
            ))}
          </dl>
          <ul className="pc-list">
            {planFeatureRows(p).map((f) => (
              <li key={f.label} className={f.ok ? '' : 'is-off'}>
                <Mark ok={f.ok} />
                <span>
                  <span className="pc-sr">{f.ok ? 'Inclui: ' : 'Não inclui: '}</span>
                  {f.value !== undefined && <b>{f.value} </b>}
                  {f.label}
                </span>
              </li>
            ))}
          </ul>
          <span className="pc-pick">{selected === p.id ? 'Plano escolhido' : `Escolher ${p.name}`}</span>
        </label>
      ))}
    </section>
  );
}
