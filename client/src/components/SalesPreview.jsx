import { useState } from 'react';
import Icon from './Icon.jsx';

const SCREENS = [
  { key: 'inicio', label: 'Início', icon: 'home', title: 'Visão geral', caption: 'Uma visão rápida da operação.' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'chat', title: 'WhatsApp conectado', caption: 'Centralize conversas e comunicações.' },
  { key: 'clientes', label: 'Clientes', icon: 'user', title: 'Clientes', caption: 'Consulte contatos e histórico de atendimento.' },
  { key: 'cobrancas', label: 'Cobranças', icon: 'money', title: 'Cobranças', caption: 'Organize vencimentos e próximos envios.' },
  { key: 'lembretes', label: 'Lembretes', icon: 'bell', title: 'Lembretes', caption: 'Programe acompanhamentos e mensagens.' },
  { key: 'contratos', label: 'Contratos', icon: 'file', title: 'Contratos', caption: 'Gerencie seus modelos e documentos.' },
  { key: 'auditoria', label: 'Auditoria', icon: 'eye', title: 'Auditoria WhatsApp', caption: 'Acompanhe conversas das conexões autorizadas.' },
  { key: 'portfolio', label: 'Portfólio', icon: 'globe', title: 'Portfólio digital', caption: 'Apresente seus produtos e serviços online.' },
  { key: 'produtos', label: 'Produtos', icon: 'box', title: 'Produtos', caption: 'Mantenha seu catálogo atualizado.' },
  { key: 'pedidos', label: 'Pedidos', icon: 'receipt', title: 'Pedidos e clientes', caption: 'Acompanhe as vendas da sua operação.' },
  { key: 'api', label: 'API', icon: 'link', title: 'API e webhooks', caption: 'Conecte ferramentas e automatize processos.' },
  { key: 'pdv', label: 'Frente de caixa', icon: 'cart', title: 'Frente de caixa', caption: 'Registre uma venda presencial com agilidade.' },
];

function Metric({ label, value, note, color = 'bg-amber-500' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5 sm:p-3">
      <p className="text-[9px] font-medium text-slate-500 sm:text-[10px]">{label}</p>
      <p className="mt-1 text-sm font-bold text-slate-900 sm:text-base">{value}</p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${color}`} style={{ width: note }} /></div>
    </div>
  );
}

function OrderRows() {
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-slate-100 px-3 py-2 text-[9px] font-semibold uppercase tracking-wide text-slate-400"><span>Cliente</span><span>Situação</span><span>Total</span></div>
      {[
        ['Mariana Costa', 'Novo', 'R$ 189,90'],
        ['Lucas Almeida', 'Atendido', 'R$ 245,00'],
        ['Ana Beatriz', 'Novo', 'R$ 82,50'],
      ].map(([name, status, total]) => (
        <div key={name} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-slate-50 px-3 py-2 last:border-0">
          <span className="flex min-w-0 items-center gap-2"><i className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-amber-100 text-[9px] font-bold not-italic text-amber-800">{name[0]}</i><span className="truncate text-[10px] font-semibold text-slate-700">{name}</span></span>
          <span className={`rounded-full px-2 py-1 text-[8px] font-bold ${status === 'Novo' ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'}`}>{status}</span>
          <strong className="text-[9px] text-slate-700">{total}</strong>
        </div>
      ))}
    </div>
  );
}

function ScreenContent({ screen }) {
  if (screen.key === 'inicio') return (
    <>
      <div className="mt-3 grid grid-cols-3 gap-2"><Metric label="Clientes" value="146" note="76%" color="bg-blue-500" /><Metric label="A receber" value="R$ 2.450" note="58%" /><Metric label="Pedidos" value="28" note="82%" color="bg-emerald-500" /></div>
      <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-center justify-between"><strong className="text-[9px] text-slate-700">Movimento da semana</strong><small className="text-[8px] text-slate-400">Últimos 7 dias</small></div><div className="mt-3 flex h-12 items-end gap-1">{['35%', '55%', '42%', '78%', '60%', '92%', '68%'].map((height, i) => <span key={i} className="flex-1 rounded-t bg-amber-400" style={{ height }} />)}</div></div>
    </>
  );
  if (screen.key === 'pedidos') return (
    <>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric label="Pedidos ativos" value="28" note="68%" />
        <Metric label="Clientes" value="146" note="78%" color="bg-blue-500" />
        <Metric label="Vendido" value="R$ 4.820" note="84%" color="bg-emerald-500" />
      </div>
      <OrderRows />
    </>
  );
  if (screen.key === 'cobrancas') return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-2"><Metric label="A vencer" value="12" note="60%" /><Metric label="Enviadas" value="34" note="82%" color="bg-emerald-500" /></div>
      <div className="mt-3 grid gap-2">
        {['Plano mensal · vence hoje', 'Consulta · vence amanhã', 'Serviço contratado · 04 nov'].map((row, i) => <div key={row} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-[9px] text-slate-700"><span className="flex items-center gap-2"><i className={`h-2 w-2 rounded-full ${i === 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />{row}</span><strong>R$ {['180,00', '250,00', '490,00'][i]}</strong></div>)}
      </div>
    </>
  );
  if (screen.key === 'lembretes') return (
    <div className="mt-3 grid gap-2">{[['Retorno para cliente', 'Hoje · 14:30', 'bg-amber-100'], ['Confirmar agendamento', 'Amanhã · 09:00', 'bg-blue-100'], ['Enviar lembrete', '04 nov · 10:00', 'bg-emerald-100']].map(([title, when, tone]) => <div key={title} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5"><span className={`grid h-7 w-7 place-items-center rounded-lg ${tone} text-slate-700`}><Icon name="bell" size={14} /></span><span><strong className="block text-[9px] text-slate-700">{title}</strong><small className="text-[8px] text-slate-500">{when}</small></span></div>)}</div>
  );
  if (screen.key === 'clientes') return (
    <>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-amber-50 p-3"><span><strong className="block text-xs text-slate-900">146 clientes</strong><small className="text-[9px] text-slate-500">Seu relacionamento organizado</small></span><Icon name="user" size={20} /></div>
      <div className="mt-3 grid gap-2">{[['Mariana Costa', 'Cliente recorrente'], ['Lucas Almeida', 'Novo cliente'], ['Ana Beatriz', 'Atendimento recente']].map(([name, note]) => <div key={name} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-600">{name[0]}</span><span><strong className="block text-[10px] text-slate-700">{name}</strong><small className="text-[9px] text-slate-500">{note}</small></span></div>)}</div>
    </>
  );
  if (screen.key === 'whatsapp') return (
    <div className="mt-3 grid gap-2">{[['Cliente · Mariana', 'Oi! Pode me ajudar com meu pedido?', 'bg-white'], ['Você', 'Claro! Vou conferir para você.', 'bg-emerald-50'], ['Cliente · Mariana', 'Obrigada!', 'bg-white']].map(([name, message, tone], i) => <div key={name} className={`max-w-[90%] rounded-xl p-2 ${i === 1 ? 'ml-auto' : ''} ${tone}`}><strong className="block text-[8px] text-slate-500">{name}</strong><p className="mt-1 text-[9px] text-slate-700">{message}</p></div>)}</div>
  );
  if (screen.key === 'contratos') return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-50 text-blue-700"><Icon name="file" size={16} /></span><span><strong className="block text-[10px] text-slate-800">Prestação de serviços</strong><small className="text-[8px] text-slate-500">Modelo atualizado · 12 campos</small></span></div><div className="mt-3 grid gap-1.5">{['Identificação das partes', 'Descrição dos serviços', 'Condições e assinaturas'].map((row) => <div key={row} className="rounded-md bg-slate-50 px-2 py-1.5 text-[8px] text-slate-600">{row}</div>)}</div></div>
  );
  if (screen.key === 'produtos') return (
    <div className="mt-3 grid grid-cols-3 gap-2">{[['Produto A', 'R$ 49,90'], ['Produto B', 'R$ 89,00'], ['Serviço C', 'R$ 120,00']].map(([name, price], i) => <div key={name} className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className={`grid h-14 place-items-center ${i === 1 ? 'bg-blue-50' : 'bg-amber-50'} text-slate-400`}><Icon name="box" size={18} /></div><div className="p-2"><strong className="block text-[9px] text-slate-700">{name}</strong><small className="text-[8px] text-slate-500">{price}</small></div></div>)}</div>
  );
  if (screen.key === 'api') return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-[8px] leading-5 text-emerald-200"><div className="text-slate-400">Integração · pedidos</div><div><span className="text-amber-300">GET</span> /api/v1/orders</div><div className="text-slate-400">{'{'} "status": "paid",</div><div className="text-slate-400">"total": 3 {'}'}</div><div className="mt-2 inline-flex rounded-md bg-emerald-400/10 px-2 text-emerald-300">Webhook ativo</div></div>
  );
  if (screen.key === 'pdv') return (
    <div className="mt-3 grid grid-cols-[1.2fr_0.8fr] gap-2">
      <div className="grid grid-cols-2 gap-2">{['Produto A', 'Produto B', 'Serviço', 'Produto C'].map((name, i) => <div key={name} className="rounded-xl border border-slate-200 bg-white p-2"><span className="grid h-8 place-items-center rounded-lg bg-slate-100 text-slate-400"><Icon name="box" size={16} /></span><strong className="mt-1 block text-[9px] text-slate-700">{name}</strong><small className="text-[9px] text-slate-500">R$ {['49,90', '89,00', '120,00', '35,00'][i]}</small></div>)}</div>
      <div className="rounded-xl bg-slate-900 p-2.5 text-white"><small className="text-[9px] text-slate-300">Venda atual</small><strong className="mt-2 block text-sm">R$ 138,90</strong><span className="mt-3 block rounded-lg bg-amber-400 px-2 py-1.5 text-center text-[9px] font-bold text-slate-950">Finalizar venda</span></div>
    </div>
  );
  if (screen.key === 'auditoria') return (
    <div className="mt-3 grid gap-2">{[['Mariana Costa', 'Olá! Gostaria de saber sobre meu pedido.', '10:42'], ['Loja Central', 'Claro! Já vou verificar para você.', '10:44'], ['Lucas Almeida', 'Obrigado pelo atendimento!', '10:51']].map(([name, message, time], i) => <div key={time} className={`max-w-[90%] rounded-xl p-2.5 ${i === 1 ? 'ml-auto bg-emerald-50' : 'bg-white shadow-sm'}`}><div className="flex justify-between gap-3"><strong className="text-[9px] text-slate-700">{name}</strong><small className="text-[8px] text-slate-400">{time}</small></div><p className="mt-1 text-[9px] leading-4 text-slate-600">{message}</p></div>)}</div>
  );
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {['Novidades da semana', 'Conheça nossos serviços'].map((title, i) => <div key={title} className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className={`grid h-16 place-items-center ${i ? 'bg-blue-100 text-blue-500' : 'bg-amber-100 text-amber-700'}`}><Icon name={i ? 'globe' : 'box'} size={22} /></div><div className="p-2"><strong className="block text-[9px] text-slate-800">{title}</strong><small className="text-[8px] text-slate-500">Página publicada · ver catálogo</small></div></div>)}
    </div>
  );
}

export default function SalesPreview({ variant = 'business', activeScreen, onScreenChange }) {
  const [localActive, setLocalActive] = useState('pedidos');
  const active = activeScreen || localActive;
  const selectScreen = (key) => {
    setLocalActive(key);
    onScreenChange?.(key);
  };
  const screen = SCREENS.find((item) => item.key === active) || SCREENS[0];
  const visibleScreens = variant === 'agency' || variant === 'features'
    ? SCREENS
    : SCREENS.filter((item) => ['pedidos', 'cobrancas', 'clientes', 'pdv'].includes(item.key));

  return (
    <div className="relative mx-auto w-full max-w-[42rem]">
      <div className="absolute -inset-6 rounded-[2.5rem] bg-amber-300/20 blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 sm:rounded-3xl">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5 sm:px-4">
          <span className="flex gap-1"><i className="h-2 w-2 rounded-full bg-red-300" /><i className="h-2 w-2 rounded-full bg-amber-300" /><i className="h-2 w-2 rounded-full bg-emerald-300" /></span>
          <span className="mx-auto rounded-md border border-slate-200 bg-white px-5 py-1 text-[9px] text-slate-400 sm:px-10">app.dmgerenciador.com.br</span>
          <span className="hidden text-[9px] font-semibold text-slate-500 sm:inline">PRÉVIA INTERATIVA</span>
        </div>
        <div className="grid min-h-[18rem] grid-cols-[7.25rem_1fr] sm:min-h-[22rem] sm:grid-cols-[10.5rem_1fr]">
          <aside className="bg-slate-950 p-2 text-white sm:p-3">
            <div className="flex items-center gap-1.5 border-b border-white/10 px-1 pb-3 pt-1"><span className="grid h-6 w-6 place-items-center rounded-lg bg-amber-400 text-[9px] font-black text-slate-950">DM</span><span className="text-[9px] font-bold sm:text-[10px]">Gerenciador</span></div>
            <p className="px-1 pb-1 pt-3 text-[7px] font-bold uppercase tracking-wider text-slate-500 sm:text-[8px]">Áreas do sistema</p>
            <nav className="grid max-h-[15.5rem] gap-1 overflow-y-auto" aria-label="Prévia das abas do sistema">
              {visibleScreens.map((item) => <button key={item.key} type="button" onClick={() => selectScreen(item.key)} aria-pressed={active === item.key} className={`flex w-full items-center gap-1.5 rounded-lg px-1.5 py-2 text-left text-[8px] transition sm:gap-2 sm:px-2 sm:text-[9px] ${active === item.key ? 'bg-amber-400 font-bold text-slate-950' : 'text-slate-300 hover:bg-white/10'}`}><Icon name={item.icon} size={13} /><span className="truncate">{item.label}</span></button>)}
            </nav>
            {variant === 'agency' && <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-2"><small className="block text-[7px] text-slate-400">GESTÃO DE CLIENTES</small><strong className="mt-1 block text-[8px] text-amber-200">3 lojas conectadas</strong></div>}
          </aside>
          <section className="min-w-0 bg-slate-50 p-2.5 sm:p-4">
            <div className="flex items-start justify-between gap-2 border-b border-slate-200 pb-2.5">
              <span><small className="block text-[8px] text-slate-400">Início / {screen.label}</small><h3 className="mt-1 text-xs font-bold text-slate-900 sm:text-sm">{screen.title}</h3><p className="mt-0.5 text-[8px] text-slate-500 sm:text-[9px]">{screen.caption}</p></span>
              <span className="hidden rounded-full bg-emerald-50 px-2 py-1 text-[8px] font-semibold text-emerald-700 sm:inline">● Operação ativa</span>
            </div>
            <ScreenContent screen={screen} />
            <p className="mt-3 text-center text-[8px] text-slate-400">Prévia ilustrativa das telas do DM Gerenciador</p>
          </section>
        </div>
      </div>
    </div>
  );
}
