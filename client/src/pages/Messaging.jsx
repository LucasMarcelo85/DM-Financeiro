import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import Lamp from '../components/Lamp.jsx';
import { useToast } from '../components/Toast.jsx';
import { useInstances } from '../lib/useInstances.js';
import { dateTimeBR, digits, formatDoc, formatStoredPhone, maskPhone } from '../lib/format.js';
import { STATUS_TEXT } from './Dashboard.jsx';

const COPY = {
  cobranca: {
    title: 'Enviar cobrança',
    intro: 'Escreva a mensagem, informe o número do cliente e, se quiser, o link de pagamento ou a chave Pix.',
    textLabel: 'Mensagem da cobrança',
    template: 'Olá! Tudo bem? Passando para lembrar do pagamento de R$ 0,00 com vencimento em __/__/____. Qualquer dúvida, é só responder esta mensagem.',
    extraLabel: 'Link de pagamento ou chave Pix (opcional)',
    extraPlaceholder: 'https://... ou chave Pix',
    button: 'Enviar cobrança',
    sent: 'Cobrança enviada',
    history: 'Últimas cobranças',
  },
  lembrete: {
    title: 'Enviar lembrete',
    intro: 'Avise o cliente sobre um vencimento. Se incluir link ou Pix, ele chega em uma mensagem separada.',
    textLabel: 'Mensagem do lembrete',
    template: 'Olá! Lembrete: seu pagamento vence amanhã. Se já pagou, pode desconsiderar esta mensagem.',
    extraLabel: 'Link ou chave Pix (opcional)',
    extraPlaceholder: 'https://... ou chave Pix',
    button: 'Enviar lembrete',
    sent: 'Lembrete enviado',
    history: 'Últimos lembretes',
  },
};

function Preview({ text, extra }) {
  return (
    <div className="chat" aria-label="Prévia da mensagem">
      <p className="chat-title">Como o cliente vai receber</p>
      <div className="chat-body">
        {text.trim() ? <div className="bubble">{text}</div> : <div className="bubble bubble-empty">Sua mensagem aparece aqui</div>}
        {extra.trim() && <div className="bubble">{extra}</div>}
      </div>
      <p className="chat-note">{extra.trim() ? '2 mensagens: texto e, logo depois, o link ou Pix sozinho.' : '1 mensagem.'}</p>
    </div>
  );
}

function MessageForm({ kind }) {
  const c = COPY[kind];
  const toast = useToast();
  const { data, error } = useInstances(6000);
  const [instanceId, setInstanceId] = useState('');
  const [number, setNumber] = useState('');
  const [text, setText] = useState('');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null);

  const loadHistory = useCallback(() => {
    api.get(`/messages?kind=${kind}&limit=8`).then((r) => setHistory(r.messages)).catch(() => setHistory([]));
  }, [kind]);
  useEffect(loadHistory, [loadHistory]);

  const connected = (data?.instances || []).filter((i) => i.connected);
  const selected = connected.find((i) => String(i.id) === String(instanceId)) || connected[0];
  const phoneOk = [10, 11].includes(digits(number).length);
  const canSend = Boolean(selected) && phoneOk && text.trim().length > 0 && !busy;

  async function submit(e) {
    e.preventDefault();
    if (!canSend) return;
    setBusy(true);
    try {
      await api.post('/messages', { kind, instanceId: selected.id, number, text, extra });
      toast(`${c.sent} para ${number}.`);
      setNumber('');
      setExtra('');
      loadHistory();
    } catch (err) {
      toast(err.message, 'error');
      loadHistory();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="page-head">
        <h1>{c.title}</h1>
        <p className="muted">{c.intro}</p>
      </header>

      {data && !selected && (
        <div className="banner banner-red">
          <Lamp on={false} size="sm" />
          <div>
            <strong>WhatsApp desconectado</strong>
            <span>{error || 'Conecte seu WhatsApp para poder enviar.'}</span>
          </div>
          <Link to="/whatsapp" className="btn btn-primary btn-sm">Conectar</Link>
        </div>
      )}

      <div className="split">
        <form className="card form" onSubmit={submit} noValidate>
          {connected.length > 1 && (
            <label className="field">
              <span>Enviar pelo WhatsApp</span>
              <select className="input" value={selected?.id ?? ''} onChange={(e) => setInstanceId(e.target.value)}>
                {connected.map((i) => <option key={i.id} value={i.id}>{formatDoc(i.name)}</option>)}
              </select>
            </label>
          )}
          {connected.length === 1 && (
            <p className="sender"><Lamp on size="sm" /> Enviando por <strong>{formatDoc(connected[0].name)}</strong></p>
          )}

          <label className="field">
            <span>Número do cliente</span>
            <input className="input" type="tel" inputMode="tel" value={number} onChange={(e) => setNumber(maskPhone(e.target.value))} placeholder="(85) 99999-9999" autoComplete="off" />
          </label>

          <label className="field">
            <span className="field-line">
              {c.textLabel}
              {!text && <button type="button" className="link-btn" onClick={() => setText(c.template)}>Usar mensagem pronta</button>}
            </span>
            <textarea className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
            <small>{text.length}/4000</small>
          </label>

          <label className="field">
            <span>{c.extraLabel}</span>
            <input className="input" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={c.extraPlaceholder} maxLength={1000} autoComplete="off" />
            <small>Vai em uma segunda mensagem, só com o link ou a chave, para o cliente copiar e colar com um toque.</small>
          </label>

          <button className="btn btn-primary btn-block" disabled={!canSend}>
            <Icon name="send" size={18} /> {busy ? 'Enviando...' : c.button}
          </button>
        </form>

        <div className="side">
          <Preview text={text} extra={extra} />
        </div>
      </div>

      <section className="card">
        <h2 className="card-title">{c.history}</h2>
        {history === null ? (
          <p className="muted">Carregando...</p>
        ) : history.length === 0 ? (
          <p className="empty">Nada enviado ainda.</p>
        ) : (
          <ul className="history">
            {history.map((m) => (
              <li key={m.id}>
                <span className="history-main">{formatStoredPhone(m.number)}{m.hasExtra ? ' · com link/Pix' : ''}</span>
                <span className={`pill pill-${m.status}`}>{STATUS_TEXT[m.status]}</span>
                <time>{dateTimeBR(m.createdAt)}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export const Charge = () => <MessageForm kind="cobranca" />;
export const Reminder = () => <MessageForm kind="lembrete" />;
