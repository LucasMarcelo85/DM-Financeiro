import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import ContactPicker, { clientPayload, clientReady } from '../components/ContactPicker.jsx';
import Icon from '../components/Icon.jsx';
import Lamp from '../components/Lamp.jsx';
import { useToast } from '../components/Toast.jsx';
import { useInstances } from '../lib/useInstances.js';
import { addDaysISO, centsToMasked, isoDay, isoToBR, maskMoney, moneyToCents, todayISO } from '../lib/format.js';
import { KIND, beforeText, previewFirstRun, renderPreview } from '../lib/schedule.js';

const DAY_CHIPS = [0, 1, 2, 3, 5, 7];

function Preview({ text, extra, name, amountCents, dueISO }) {
  const ctx = { name, amountCents, dueISO };
  return (
    <div className="chat" aria-label="Prévia da mensagem">
      <p className="chat-title">Como o cliente vai receber</p>
      <div className="chat-body">
        {text.trim() ? <div className="bubble">{renderPreview(text, ctx)}</div> : <div className="bubble bubble-empty">Sua mensagem aparece aqui</div>}
        {extra.trim() && <div className="bubble">{renderPreview(extra, ctx)}</div>}
      </div>
      <p className="chat-note">{extra.trim() ? '2 mensagens: o texto e, logo depois, só o link ou Pix, fácil de copiar.' : '1 mensagem.'}</p>
    </div>
  );
}

export default function ScheduleForm({ kind }) {
  const cfg = KIND[kind];
  const { id } = useParams();
  const editing = Boolean(id);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: inst } = useInstances(8000);
  const taRef = useRef(null);

  const [loading, setLoading] = useState(editing);
  const [client, setClient] = useState(null);
  const [amount, setAmount] = useState('');
  const [recurrence, setRecurrence] = useState('avulsa');
  const [dueDate, setDueDate] = useState(() => addDaysISO(todayISO(), 7));
  const [sendMode, setSendMode] = useState('agendar');
  const [daysBefore, setDaysBefore] = useState(2);
  const [sendTime, setSendTime] = useState('09:00');
  const [text, setText] = useState(cfg.template);
  const [extra, setExtra] = useState('');
  const [instanceId, setInstanceId] = useState('');
  const [status, setStatus] = useState('ativa');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editing) {
      api.get(`/schedules/${id}`).then(({ schedule: s }) => {
        if (s.kind !== kind) return navigate(`${KIND[s.kind].route}/${s.id}`, { replace: true });
        setClient({ id: s.contact.id, name: s.contact.name, phone: s.contact.phone });
        setAmount(s.amountCents != null ? centsToMasked(s.amountCents) : '');
        setRecurrence(s.recurrence); setDueDate(s.dueDate); setDaysBefore(s.daysBefore); setSendTime(s.sendTime);
        setText(s.text); setExtra(s.extra || ''); setInstanceId(s.instanceId ? String(s.instanceId) : ''); setStatus(s.status);
        setLoading(false);
      }).catch((e) => { toast(e.message, 'error'); navigate(cfg.route, { replace: true }); });
    } else if (params.get('cliente')) {
      api.get(`/contacts/${params.get('cliente')}`).then(({ contact: c }) => setClient({ id: c.id, name: c.name, phone: c.phone })).catch(() => {});
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const money = moneyToCents(amount);
  const run = useMemo(() => previewFirstRun({ recurrence, dueDate, daysBefore, sendTime }), [recurrence, dueDate, daysBefore, sendTime]);
  const instances = inst?.instances || [];
  const connected = instances.filter((i) => i.connected);
  const now = sendMode === 'agora';

  const ready = clientReady(client) && text.trim().length > 0 && Boolean(dueDate) && (kind === 'lembrete' || money > 0)
    && (now ? connected.length > 0 : Boolean(run) || status === 'pausada');

  function pickRecurrence(r) { setRecurrence(r); if (r === 'mensal') setSendMode('agendar'); }

  function insertVar(tag) {
    const el = taRef.current;
    const a = el?.selectionStart ?? text.length;
    const b = el?.selectionEnd ?? text.length;
    setText(text.slice(0, a) + tag + text.slice(b));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(a + tag.length, a + tag.length); });
  }

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    const payload = {
      kind, recurrence, sendMode, dueDate, daysBefore, sendTime, text, extra,
      instanceId: instanceId || null, amountCents: kind === 'cobranca' ? money : undefined, ...clientPayload(client),
    };
    try {
      const r = editing ? await api.patch(`/schedules/${id}`, payload) : await api.post('/schedules', payload);
      const who = r.schedule.contact.name;
      if (r.warning) toast(r.warning, 'error');
      else if (editing) toast('Alterações salvas.');
      else toast(now ? `Enviado para ${who}.` : `Agendado para ${who}. Primeiro envio em ${isoToBR(run.runDay)} às ${sendTime}.`);
      navigate(cfg.route);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Carregando...</p>;

  const summary = now ? (
    <>A mensagem sai assim que você clicar em <strong>Enviar agora</strong>.</>
  ) : !run ? (
    <span className="warn">Esse dia e horário já passaram. Escolha uma data futura{recurrence === 'avulsa' ? ' ou use "Enviar agora"' : ''}.</span>
  ) : recurrence === 'avulsa' ? (
    <>Será enviada em <strong>{isoToBR(run.runDay)} às {sendTime}</strong> ({beforeText(daysBefore)}).</>
  ) : (
    <>Todo mês, {beforeText(daysBefore)} (vencimento dia {isoDay(dueDate)}), às {sendTime}. Primeiro envio: <strong>{isoToBR(run.runDay)} às {sendTime}</strong>.{run.k > 0 && ' O deste mês já passou do horário.'}</>
  );

  return (
    <main className={`schedule-form-page kind-${kind}`}>
      <header className="page-head">
        <Link to={cfg.route} className="back-link"><Icon name="left" size={16} /> {cfg.title}</Link>
        <h1>{editing ? `Editar ${cfg.singular}` : cfg.newLabel}</h1>
        <p className="muted">Preencha os passos abaixo. A prévia ao lado mostra como o cliente vai receber.</p>
      </header>

      {inst && connected.length === 0 && (
        <div className={`banner ${now ? 'banner-red' : 'banner-amber'}`}>
          <Lamp on={false} size="sm" />
          <div>
            <strong>WhatsApp desconectado</strong>
            <span>{now ? 'Conecte para poder enviar agora.' : 'Conecte antes do horário do envio, senão a mensagem não sai.'}</span>
          </div>
          <Link to="/whatsapp" className="btn btn-primary btn-sm">Conectar</Link>
        </div>
      )}

      <div className="split schedule-form-layout">
        <form className="stack" onSubmit={submit} noValidate>
          <section className="card step">
            <h2><span className="step-n">1</span> Cliente</h2>
            <ContactPicker value={client} onChange={setClient} />
          </section>

          <section className="card step">
            <h2><span className="step-n">2</span> {kind === 'cobranca' ? 'Valor e vencimento' : 'Vencimento'}</h2>
            <div className="seg" role="radiogroup" aria-label="Frequência">
              <button type="button" role="radio" aria-checked={recurrence === 'avulsa'} className={recurrence === 'avulsa' ? 'is-on' : ''} onClick={() => pickRecurrence('avulsa')}>Avulsa<small>uma vez só</small></button>
              <button type="button" role="radio" aria-checked={recurrence === 'mensal'} className={recurrence === 'mensal' ? 'is-on' : ''} onClick={() => pickRecurrence('mensal')}>Mensal<small>todo mês</small></button>
            </div>
            <div className="form-row">
              {kind === 'cobranca' && (
                <label className="field"><span>Valor</span>
                  <div className="money"><b>R$</b><input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(maskMoney(e.target.value))} placeholder="0,00" autoComplete="off" /></div>
                </label>
              )}
              <label className="field"><span>{recurrence === 'mensal' ? 'Primeiro vencimento' : 'Data do vencimento'}</span>
                <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                {recurrence === 'mensal' && dueDate && <small>Vence todo dia {isoDay(dueDate)}.</small>}
              </label>
            </div>
          </section>

          <section className="card step">
            <h2><span className="step-n">3</span> Quando enviar</h2>
            {!editing && recurrence === 'avulsa' && (
              <div className="seg" role="radiogroup" aria-label="Momento do envio">
                <button type="button" role="radio" aria-checked={!now} className={!now ? 'is-on' : ''} onClick={() => setSendMode('agendar')}>Agendar</button>
                <button type="button" role="radio" aria-checked={now} className={now ? 'is-on' : ''} onClick={() => setSendMode('agora')}>Enviar agora</button>
              </div>
            )}
            {!now && (
              <>
                <div className="field">
                  <span>Enviar</span>
                  <div className="chips" role="group" aria-label="Dias antes do vencimento">
                    {DAY_CHIPS.map((n) => (
                      <button key={n} type="button" className={`chip ${daysBefore === n ? 'is-on' : ''}`} onClick={() => setDaysBefore(n)}>{n === 0 ? 'No dia' : n === 1 ? '1 dia antes' : `${n} dias antes`}</button>
                    ))}
                    <label className="chip-input">outro: <input type="number" min={0} max={30} value={daysBefore} onChange={(e) => setDaysBefore(Math.min(30, Math.max(0, Math.floor(Number(e.target.value) || 0))))} aria-label="Dias antes do vencimento" /> dias</label>
                  </div>
                </div>
                <label className="field time-field"><span>Horário</span><input className="input" type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value || '09:00')} /></label>
              </>
            )}
            <p className={`summary ${!now && !run ? 'is-warn' : ''}`}><Icon name="clock" size={18} /><span>{summary}</span></p>
            {instances.length > 1 && !now && (
              <label className="field"><span>Enviar pelo WhatsApp</span>
                <select className="input" value={instanceId} onChange={(e) => setInstanceId(e.target.value)}>
                  <option value="">Qualquer um que esteja conectado</option>
                  {instances.map((i) => <option key={i.id} value={i.id}>{i.name}{i.connected ? '' : ' (desconectado)'}</option>)}
                </select>
              </label>
            )}
          </section>

          <section className="card step">
            <h2><span className="step-n">4</span> Mensagem</h2>
            <div className="field">
              <span className="field-line">Texto
                <button type="button" className="link-btn" onClick={() => setText(cfg.template)}>Usar mensagem pronta</button>
              </span>
              <div className="chips" aria-label="Inserir no texto">
                <button type="button" className="chip chip-var" onClick={() => insertVar('{nome}')}>+ nome</button>
                {kind === 'cobranca' && <button type="button" className="chip chip-var" onClick={() => insertVar('{valor}')}>+ valor</button>}
                <button type="button" className="chip chip-var" onClick={() => insertVar('{vencimento}')}>+ vencimento</button>
              </div>
              <textarea ref={taRef} className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
              <small>{text.length}/4000. Os campos entre chaves são trocados pelos dados do cliente na hora do envio.</small>
            </div>
            <label className="field"><span>Link de pagamento ou chave Pix (opcional)</span>
              <input className="input" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="https://... ou chave Pix" maxLength={1000} autoComplete="off" />
              <small>Vai em uma segunda mensagem, só com o link ou a chave, para o cliente copiar e colar com um toque.</small>
            </label>
          </section>

          <div className="form-actions">
            <Link to={cfg.route} className="btn btn-ghost">Cancelar</Link>
            <button className="btn btn-primary" disabled={!ready || busy}>
              <Icon name={now ? 'send' : 'check'} size={18} />
              {busy ? 'Salvando...' : editing ? 'Salvar alterações' : now ? 'Enviar agora' : `Agendar ${cfg.singular}`}
            </button>
          </div>
        </form>

        <div className="side">
          <Preview text={text} extra={extra} name={client?.name} amountCents={kind === 'cobranca' ? money : null} dueISO={dueDate} />
        </div>
      </div>
    </main>
  );
}
