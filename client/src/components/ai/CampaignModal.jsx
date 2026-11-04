import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import Icon from '../Icon.jsx';
import Modal from '../Modal.jsx';
import { useToast } from '../Toast.jsx';
import { formatStoredPhone } from '../../lib/format.js';

const MIN_INTERVAL_S = 20;
const OPEN = ['scheduled', 'running', 'paused'];
const STATUS = {
  scheduled: 'Agendada', running: 'Em andamento', paused: 'Pausada', completed: 'Concluída', cancelled: 'Cancelada',
};
const ITEM = { pending: 'Aguardando', sending: 'Enviando...', sent: 'Enviada', failed: 'Falhou', skipped: 'Não enviada' };

const pad = (n) => String(n).padStart(2, '0');
const toLocalInput = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
const fmtTime = (value) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
function countdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}h ${pad(m)}min ${pad(s)}s` : `${pad(m)}:${pad(s)}`;
}

export default function CampaignModal({ agent, onClose }) {
  const toast = useToast();
  const [campaigns, setCampaigns] = useState(null);
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0);
  const [message, setMessage] = useState('');
  const [startAt, setStartAt] = useState(() => toLocalInput(new Date(Date.now() + 60 * 1000)));
  const [endAt, setEndAt] = useState(() => toLocalInput(new Date(Date.now() + 61 * 60 * 1000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await api.get(`/ai/campaigns?agentId=${agent.id}`);
      offset.current = new Date(result.serverNow).getTime() - Date.now();
      setCampaigns(result.campaigns);
    } catch (err) { setError(err.message); }
  }, [agent.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now() + offset.current), 1000);
    const poll = setInterval(load, 3000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [load]);

  const current = campaigns?.find((item) => OPEN.includes(item.status)) || null;
  const last = !current ? campaigns?.[0] : null;
  const total = agent.contactIds.length;
  const startDate = new Date(startAt);
  const endDate = new Date(endAt);
  const validDates = !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime());
  const effectiveStart = validDates ? Math.max(startDate.getTime(), Date.now()) : 0;
  const windowS = validDates ? Math.floor((endDate.getTime() - effectiveStart) / 1000) : 0;
  const intervalS = total ? windowS / total : 0;
  const tooFast = validDates && total > 0 && intervalS < MIN_INTERVAL_S;
  const invalid = !validDates || windowS <= 0 || tooFast || total === 0;

  async function start() {
    setBusy(true); setError('');
    try {
      await api.post(`/ai/agents/${agent.id}/campaign`, { message, startAt: startDate.toISOString(), endAt: endDate.toISOString() });
      toast('Campanha criada. Os envios serão feitos aos poucos.');
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function control(action, body) {
    try {
      await api.post(`/ai/campaigns/${current.id}/${action}`, body || {});
      await load();
    } catch (err) { toast(err.message, 'error'); }
  }
  function cancel() {
    if (window.confirm('Cancelar a campanha? Os contatos que ainda não receberam não serão enviados.')) control('cancel');
  }

  const done = current ? current.sent + current.failed + current.skipped : 0;
  const nextPending = current?.items.find((item) => item.status === 'pending');
  const nextIn = current?.nextRunAt ? new Date(current.nextRunAt).getTime() - now : 0;
  const waitS = current ? Math.round(current.intervalSeconds / current.speed) : 0;

  return (
    <Modal wide title={`Campanha · ${agent.name}`} onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Fechar</button>}>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!campaigns && !error && <p className="muted">Carregando...</p>}

      {campaigns && !current && (
        <div className="cmp-form">
          <p className="muted">As mensagens não saem de uma vez: cada contato recebe uma mensagem por vez, com espera entre elas distribuída por todo o período. Isso protege o número contra bloqueio por automação.</p>
          <label className="field"><span>Objetivo ou contexto da campanha</span><textarea className="input" rows="3" maxLength={1000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ex.: apresentar a coleção nova e convidar para ver os produtos no site." /><small>A IA personaliza este texto para cada contato.</small></label>
          <div className="lbl-grid">
            <label className="field"><span>Início (data e hora)</span><input className="input" type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label>
            <label className="field"><span>Término (data e hora)</span><input className="input" type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} /></label>
          </div>
          <div className={`cmp-estimate ${tooFast ? 'is-bad' : ''}`}>
            {total === 0 ? 'Este agente não tem contatos selecionados. Edite o agente e escolha os contatos.'
              : !validDates || windowS <= 0 ? 'O término precisa ser depois do início.'
                : tooFast ? `Período curto demais: ${total} contato(s) em ${countdown(windowS * 1000)} dá menos de ${MIN_INTERVAL_S}s entre mensagens. Aumente o término para pelo menos ${Math.ceil((total * MIN_INTERVAL_S) / 60)} minuto(s).`
                  : `${total} contato(s) em ${countdown(windowS * 1000)}: uma mensagem a cada ~${Math.round(intervalS)}s (com pequena variação aleatória).`}
          </div>
          <button className="btn btn-primary" onClick={start} disabled={busy || invalid}><Icon name="send" size={16} /> {busy ? 'Criando...' : 'Iniciar campanha'}</button>
        </div>
      )}

      {current && (
        <div className="cmp-monitor">
          <div className="cmp-head">
            <span className={`cmp-status is-${current.status}`}>{STATUS[current.status]}</span>
            <strong>{done} de {current.total} processadas</strong>
            <small className="muted">{fmtTime(current.startAt)} → {fmtTime(current.endAt)}</small>
          </div>
          <progress className="cmp-progress" max={current.total} value={done} />
          <div className="cmp-counts"><span>Enviadas: <strong>{current.sent}</strong></span><span>Aguardando: <strong>{current.pending}</strong></span><span>Falhas: <strong>{current.failed}</strong></span></div>

          <div className="cmp-wait">
            {current.status === 'paused' && <span>Campanha pausada. Nenhuma mensagem será enviada.</span>}
            {current.status !== 'paused' && current.outsideSchedule && <span>Fora do horário de funcionamento do agente. Aguardando o horário para continuar.</span>}
            {current.status !== 'paused' && !current.outsideSchedule && nextPending && <span>{current.status === 'scheduled' ? 'Começa em' : 'Próxima mensagem para'} <strong>{current.status === 'scheduled' ? countdown(nextIn) : (nextPending.name || formatStoredPhone(nextPending.phone))}</strong>{current.status !== 'scheduled' && <> em <strong>{countdown(nextIn)}</strong></>}</span>}
            <small className="muted">Espera entre mensagens: ~{waitS}s ({current.speed}x)</small>
          </div>
          {current.lastError && <p className="form-error" role="alert">{current.lastError}</p>}

          <div className="cmp-controls">
            {current.status === 'paused'
              ? <button className="btn btn-primary btn-sm" onClick={() => control('resume')}>Retomar</button>
              : <button className="btn btn-ghost btn-sm" onClick={() => control('pause')}>Pausar</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => control('send-now')} disabled={current.status === 'paused' || !nextPending}>Enviar próxima agora</button>
            <label className="cmp-speed">Velocidade
              <select className="input" value={current.speed} onChange={(event) => control('speed', { speed: Number(event.target.value) })}>
                <option value={1}>1x (normal)</option><option value={2}>2x (mais rápido)</option><option value={4}>4x (bem rápido)</option>
              </select>
            </label>
            <button className="btn btn-ghost btn-sm icon-btn-danger" onClick={cancel}>Cancelar campanha</button>
          </div>

          <ul className="cmp-items" aria-label="Trânsito de mensagens">
            {current.items.map((item) => (
              <li key={item.id} className={`is-${item.status} ${nextPending?.id === item.id ? 'is-next' : ''}`}>
                <span className="cmp-dot" />
                <span className="cmp-who">{item.name || formatStoredPhone(item.phone)}<small className="muted"> {item.name ? formatStoredPhone(item.phone) : ''}</small></span>
                <span className="cmp-state">
                  {item.status === 'sent' ? `Enviada ${new Date(item.sentAt).toLocaleTimeString('pt-BR')}`
                    : nextPending?.id === item.id && current.status === 'running' && !current.outsideSchedule ? `Próxima · ${countdown(nextIn)}`
                      : item.status === 'failed' || item.status === 'skipped' ? `${ITEM[item.status]}${item.error ? `: ${item.error}` : ''}` : ITEM[item.status]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {last && <p className="muted cmp-last">Última campanha: {STATUS[last.status]} · {last.sent} enviada(s), {last.failed} falha(s){last.skipped ? `, ${last.skipped} não enviada(s)` : ''}.{last.lastError ? ` ${last.lastError}` : ''}</p>}
    </Modal>
  );
}
