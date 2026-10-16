import { useState } from 'react';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';
import { brl, isoToBR, todayISO } from '../lib/format.js';
import { diffDays, lateLabel } from '../lib/billing.js';

// Marcar uma cobrança como paga: escolhe qual vencimento foi pago e o dia em que o cliente pagou.
export default function PayModal({ s, busy, onClose, onConfirm }) {
  const today = todayISO();
  const [dueDate, setDueDate] = useState(s.payDefault || s.payable[0]);
  const [paidAt, setPaidAt] = useState(today);

  const valid = Boolean(dueDate && paidAt && paidAt <= today);
  const late = valid ? Math.max(0, diffDays(dueDate, paidAt)) : null;

  return (
    <Modal
      title="Marcar como paga"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => onConfirm(s, { dueDate, paidAt })}>
            <Icon name="check" size={18} /> Confirmar pagamento
          </button>
        </>
      }
    >
      <p><strong>{s.contact.name}</strong> · {brl(s.amountCents)}</p>

      <label className="field">
        <span>Vencimento que foi pago</span>
        {s.payable.length > 1 ? (
          <select className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)}>
            {s.payable.map((d) => <option key={d} value={d}>{isoToBR(d)}</option>)}
          </select>
        ) : (
          <strong>{isoToBR(dueDate)}</strong>
        )}
      </label>

      <label className="field">
        <span>Dia em que o cliente pagou</span>
        <input className="input" type="date" value={paidAt} max={today} onChange={(e) => setPaidAt(e.target.value)} />
        <small>Esse dia entra no faturamento e na avaliação de pontualidade do cliente.</small>
      </label>

      {late !== null && (
        <div className={`summary ${late > 0 ? 'is-warn' : ''}`}>
          <Icon name="clock" size={18} />
          <span>{lateLabel(late)}.</span>
        </div>
      )}
    </Modal>
  );
}
