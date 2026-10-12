import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import ScheduleItem from '../components/ScheduleItem.jsx';
import { useToast } from '../components/Toast.jsx';
import { brl, firstName, isoToBR, todayISO } from '../lib/format.js';
import { KIND, dueInMonthISO } from '../lib/schedule.js';

const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const short = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: c % 100 ? 2 : 0 });

function CalendarView({ items, renderItem, kind }) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m0: now.getMonth() });
  const [selected, setSelected] = useState(todayISO());
  const { y, m0 } = ym;
  const today = todayISO();

  const byDay = useMemo(() => {
    const map = {};
    for (const s of items) {
      const d = dueInMonthISO(s, y, m0);
      if (d) (map[d] ||= []).push(s);
    }
    return map;
  }, [items, y, m0]);

  const lead = new Date(y, m0, 1).getDay();
  const total = new Date(y, m0 + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const iso = (d) => `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const all = Object.values(byDay).flat().filter((s) => s.status !== 'pausada');
  const sum = all.reduce((a, s) => a + (s.amountCents || 0), 0);
  const move = (n) => { const d = new Date(y, m0 + n, 1); setYm({ y: d.getFullYear(), m0: d.getMonth() }); setSelected(null); };
  const dayItems = selected ? byDay[selected] || [] : [];
  const rawTitle = new Date(y, m0, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const monthTitle = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);

  return (
    <section className="calendar card">
      <div className="cal-head">
        <div className="cal-nav">
          <button className="icon-btn" onClick={() => move(-1)} aria-label="Mês anterior"><Icon name="left" /></button>
          <h2>{monthTitle}</h2>
          <button className="icon-btn" onClick={() => move(1)} aria-label="Próximo mês"><Icon name="right" /></button>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => { setYm({ y: now.getFullYear(), m0: now.getMonth() }); setSelected(today); }}>Hoje</button>
        <p className="cal-sum">
          {all.length} {all.length === 1 ? 'vencimento' : 'vencimentos'}
          {kind === 'cobranca' && <> · <strong>{brl(sum)}</strong> previstos</>}
        </p>
      </div>

      <div className="cal-grid" role="grid" aria-label="Calendário">
        {WEEK.map((w) => <div key={w} className="cal-dow" role="columnheader">{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} className="cal-cell is-empty" />;
          const key = iso(d);
          const list = byDay[key] || [];
          return (
            <button key={key} type="button" className={`cal-cell ${key === today ? 'is-today' : ''} ${key === selected ? 'is-selected' : ''}`} onClick={() => setSelected(key === selected ? null : key)} aria-label={`Dia ${d}, ${list.length} ${list.length === 1 ? 'vencimento' : 'vencimentos'}`}>
              <span className="cal-num">{d}</span>
              <span className="cal-chips">
                {list.slice(0, 2).map((s) => (
                  <span key={s.id} className={`cal-chip is-${s.status} kind-${s.kind}`}>
                    {firstName(s.contact?.name)}{s.amountCents != null ? ` · ${short(s.amountCents)}` : ''}
                  </span>
                ))}
                {list.length > 2 && <span className="cal-more">+{list.length - 2}</span>}
              </span>
              {list.length > 0 && <span className="cal-dots">{list.slice(0, 3).map((s) => <i key={s.id} className={`is-${s.status} kind-${s.kind}`} />)}</span>}
            </button>
          );
        })}
      </div>

      <div className="cal-legend">
        <span><i className="is-ativa kind-cobranca" /> Ativa</span>
        <span><i className="is-pausada" /> Pausada</span>
        <span><i className="is-concluida" /> Enviada</span>
      </div>

      <div className="cal-day">
        {selected ? (
          dayItems.length ? (
            <>
              <h3>Vencimentos em {isoToBR(selected)}</h3>
              <ul className="sched-list">{dayItems.map(renderItem)}</ul>
            </>
          ) : <p className="muted">Nada vence em {isoToBR(selected)}.</p>
        ) : <p className="muted">Toque em um dia para ver os detalhes.</p>}
      </div>
    </section>
  );
}

export default function Schedules({ kind }) {
  const cfg = KIND[kind];
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [view, setView] = useState(() => { try { return localStorage.getItem('dm:view') || 'lista'; } catch { return 'lista'; } });
  const [filter, setFilter] = useState('todas');
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [confirmSend, setConfirmSend] = useState(null);

  const load = useCallback(() => api.get(`/schedules?kind=${kind}`).then((r) => setItems(r.schedules)).catch((e) => toast(e.message, 'error')), [kind, toast]);
  useEffect(() => {
    setItems(null);
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => clearInterval(t);
  }, [load]);

  const changeView = (v) => { setView(v); try { localStorage.setItem('dm:view', v); } catch { /* sem armazenamento */ } };
  const replace = (s) => setItems((list) => list.map((x) => (x.id === s.id ? s : x)));

  async function act(s, fn, okMsg) {
    setBusyId(s.id);
    try {
      const r = await fn();
      if (r?.schedule) replace(r.schedule);
      if (r?.warning) toast(r.warning, 'error'); else if (okMsg) toast(okMsg);
    } catch (e) { toast(e.message, 'error'); } finally { setBusyId(null); }
  }

  const sendNow = (s) => { setConfirmSend(null); return act(s, () => api.post(`/schedules/${s.id}/send-now`), `Enviado para ${s.contact.name}.`); };
  const toggle = (s) => act(s, () => api.post(`/schedules/${s.id}/${s.status === 'ativa' ? 'pause' : 'resume'}`), s.status === 'ativa' ? 'Envio pausado.' : 'Envio retomado.');
  async function remove(s) {
    setConfirmDel(null);
    try { await api.del(`/schedules/${s.id}`); setItems((l) => l.filter((x) => x.id !== s.id)); toast('Excluído.'); } catch (e) { toast(e.message, 'error'); }
  }

  const counts = useMemo(() => {
    const c = { todas: 0, ativa: 0, pausada: 0, concluida: 0 };
    (items || []).forEach((s) => { c.todas += 1; c[s.status] += 1; });
    return c;
  }, [items]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (items || []).filter((s) => (filter === 'todas' || s.status === filter) && (!term || s.contact?.name.toLowerCase().includes(term)));
  }, [items, filter, q]);

  const renderItem = (s) => <ScheduleItem key={s.id} s={s} busy={busyId === s.id} onSendNow={setConfirmSend} onToggle={toggle} onDelete={setConfirmDel} />;

  return (
    <>
      <header className="page-head head-row">
        <div>
          <h1>{cfg.title}</h1>
          <p className="muted">
            {kind === 'cobranca' ? 'Agende cobranças avulsas ou mensais e o sistema envia no horário certo.' : 'Agende lembretes de vencimento avulsos ou mensais.'}
          </p>
        </div>
        <Link to={`${cfg.route}/${kind === 'cobranca' ? 'nova' : 'novo'}`} className="btn btn-primary"><Icon name="plus" size={18} /> {cfg.newLabel}</Link>
      </header>

      <div className="toolbar">
        <div className="seg seg-view" role="radiogroup" aria-label="Modo de visualização">
          <button role="radio" aria-checked={view === 'lista'} className={view === 'lista' ? 'is-on' : ''} onClick={() => changeView('lista')}><Icon name="list" size={16} /> Lista</button>
          <button role="radio" aria-checked={view === 'calendario'} className={view === 'calendario' ? 'is-on' : ''} onClick={() => changeView('calendario')}><Icon name="calendar" size={16} /> Calendário</button>
        </div>
        {view === 'lista' && (
          <>
            <div className="chips" role="group" aria-label="Filtrar por situação">
              {[['todas', 'Todas'], ['ativa', 'Ativas'], ['pausada', 'Pausadas'], ['concluida', 'Concluídas']].map(([k, label]) => (
                <button key={k} className={`chip ${filter === k ? 'is-on' : ''}`} onClick={() => setFilter(k)}>{label} <span>{counts[k]}</span></button>
              ))}
            </div>
            <div className="search-box toolbar-search"><Icon name="search" size={18} /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente" aria-label="Buscar cliente" /></div>
          </>
        )}
      </div>

      {items === null ? <p className="muted">Carregando...</p> : items.length === 0 ? (
        <section className="empty-hero">
          <span className="action-icon action-icon-lg"><Icon name={kind === 'cobranca' ? 'money' : 'bell'} size={32} /></span>
          <h2>{kind === 'cobranca' ? 'Nenhuma cobrança ainda' : 'Nenhum lembrete ainda'}</h2>
          <p>Escolha um cliente, defina o vencimento e quando enviar. O resto é automático.</p>
          <Link to={`${cfg.route}/${kind === 'cobranca' ? 'nova' : 'novo'}`} className="btn btn-primary">{cfg.newLabel}</Link>
        </section>
      ) : view === 'calendario' ? (
        <CalendarView items={items} renderItem={renderItem} kind={kind} />
      ) : visible.length === 0 ? (
        <p className="empty">Nada encontrado com esse filtro.</p>
      ) : (
        <ul className="sched-list">{visible.map(renderItem)}</ul>
      )}

      {confirmSend && (
        <Modal title={`Enviar ${cfg.singular} agora?`} onClose={() => setConfirmSend(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setConfirmSend(null)}>Cancelar</button><button className="btn btn-primary" onClick={() => sendNow(confirmSend)}>Enviar agora</button></>}>
          <p>A mensagem vai para <strong>{confirmSend.contact.name}</strong> agora.{confirmSend.recurrence === 'avulsa' && confirmSend.status === 'ativa' ? ' Como é avulsa, o envio agendado será cancelado para não duplicar.' : ' Os próximos envios mensais continuam como estão.'}</p>
        </Modal>
      )}
      {confirmDel && (
        <Modal title={`Excluir ${cfg.singular}?`} onClose={() => setConfirmDel(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>Cancelar</button><button className="btn btn-danger" onClick={() => remove(confirmDel)}>Excluir</button></>}>
          <p>Os envios de <strong>{confirmDel.contact.name}</strong> deixam de acontecer. O histórico do que já foi enviado é mantido.</p>
        </Modal>
      )}
    </>
  );
}
