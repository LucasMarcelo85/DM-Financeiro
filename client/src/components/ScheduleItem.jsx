import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import Stars from './Stars.jsx';
import { brl, formatStoredPhone, initials, isoToBR } from '../lib/format.js';
import { clientHabit } from '../lib/billing.js';
import { KIND, beforeText, dueText, nextText, statusInfo } from '../lib/schedule.js';

export default function ScheduleItem({ s, busy, rating, onSendNow, onToggle, onDelete, onPaid, onUndo }) {
  const st = statusInfo(s);
  const cfg = KIND[s.kind];
  const canToggle = s.status === 'ativa' || s.status === 'pausada';
  const isBill = s.kind === 'cobranca';
  const lastPaid = isBill ? s.payments?.[0] : null; // pagamento do vencimento mais recente

  return (
    <li className={`sched ${s.status === 'pausada' ? 'is-paused' : ''}`}>
      <span className="avatar">{initials(s.contact?.name)}</span>
      <div className="sched-main">
        <div className="sched-title">
          <strong>{s.contact?.name}</strong>
          {s.amountCents != null && <span className="sched-amount">{brl(s.amountCents)}</span>}
        </div>
        <div className="sched-meta">
          <span className={`tag ${s.recurrence === 'mensal' ? 'tag-monthly' : ''}`}>{s.recurrence === 'mensal' ? 'Mensal' : 'Avulsa'}</span>
          <span className={`pill ${st.cls}`}>{st.label}</span>
          <span>{dueText(s)} · avisa {beforeText(s.daysBefore)}, {s.sendTime}</span>
        </div>
        <div className="sched-next">
          {nextText(s)}
          <span className="muted"> · {formatStoredPhone(s.contact?.phone)}</span>
        </div>
        {lastPaid && (
          <div className="sched-paid">
            <Icon name="check" size={14} />
            <span>{s.recurrence === 'mensal' ? 'Último pagamento' : 'Paga'} em {isoToBR(lastPaid.paidAt)} (venc. {isoToBR(lastPaid.dueDate)})</span>
            <button className="link-btn" onClick={() => onUndo(lastPaid)}>Desfazer</button>
          </div>
        )}
        {isBill && rating && (
          <div className="sched-rating">
            <Stars value={rating.stars} size={15} />
            <span className="muted">{clientHabit(rating)}</span>
          </div>
        )}
        {s.lastStatus === 'failed' && s.lastError && <div className="sched-error">{s.lastError}</div>}
      </div>
      <div className="sched-actions">
        {isBill && (
          <button className="icon-btn icon-btn-ok" disabled={busy || s.payable.length === 0} onClick={() => onPaid(s)}
            aria-label="Marcar como paga" title={s.payable.length === 0 ? 'Todos os vencimentos já estão pagos' : 'Marcar como paga'}>
            <Icon name="check" size={18} />
          </button>
        )}
        <button className="icon-btn" disabled={busy} onClick={() => onSendNow(s)} aria-label={`Enviar ${cfg.singular} agora`} title="Enviar agora"><Icon name="send" size={18} /></button>
        {canToggle && (
          <button className="icon-btn" disabled={busy} onClick={() => onToggle(s)} aria-label={s.status === 'ativa' ? 'Pausar' : 'Retomar'} title={s.status === 'ativa' ? 'Pausar' : 'Retomar'}>
            <Icon name={s.status === 'ativa' ? 'pause' : 'play'} size={18} />
          </button>
        )}
        <Link className="icon-btn" to={`${cfg.route}/${s.id}`} aria-label="Editar" title="Editar"><Icon name="edit" size={18} /></Link>
        <button className="icon-btn icon-btn-danger" disabled={busy} onClick={() => onDelete(s)} aria-label="Excluir" title="Excluir"><Icon name="trash" size={18} /></button>
      </div>
    </li>
  );
}
