import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import { Brand } from '../components/Layout.jsx';
import SalesPreview from '../components/SalesPreview.jsx';
import { brl, plural } from '../lib/format.js';

const FEATURES = [
  { key: 'whatsapp', icon: 'chat', title: 'WhatsApp', text: 'Visualize conversas e use suas conexões para se comunicar com clientes.' },
  { key: 'cobrancas', icon: 'money', title: 'Cobranças', text: 'Acompanhe valores, vencimentos e notificações de cobrança.' },
  { key: 'lembretes', icon: 'bell', title: 'Lembretes', text: 'Programe retornos e mensagens para não perder acompanhamentos.' },
  { key: 'clientes', icon: 'user', title: 'Clientes', text: 'Consulte cadastros, histórico e oportunidades de relacionamento.' },
  { key: 'contratos', icon: 'file', title: 'Contratos', text: 'Gere documentos usando modelos personalizados e dados do cliente.' },
  { key: 'auditoria', icon: 'eye', title: 'Auditoria WhatsApp', text: 'Supervisione conversas das conexões autorizadas pela sua equipe.' },
  { key: 'portfolio', icon: 'globe', title: 'Portfólio digital', text: 'Monte páginas, sites e catálogos para apresentar seus serviços.' },
  { key: 'produtos', icon: 'box', title: 'Produtos e serviços', text: 'Gerencie itens do catálogo, preços e disponibilidade.' },
  { key: 'pedidos', icon: 'receipt', title: 'Pedidos e clientes', text: 'Acompanhe pedidos, situação de atendimento e valores vendidos.' },
  { key: 'pdv', icon: 'cart', title: 'Frente de caixa', text: 'Simule uma venda presencial selecionando itens e conferindo o total.' },
  { key: 'api', icon: 'link', title: 'API e webhooks', text: 'Veja como conectar integrações e automatizar eventos do sistema.' },
];

const PLAN_FEATURES = [
  ['instances', 'conexão WhatsApp para cobranças e lembretes', 'conexões WhatsApp para cobranças e lembretes'],
  ['auditInstances', 'conexão para auditoria de conversas', 'conexões para auditoria de conversas'],
  ['contracts', 'modelo de contrato', 'modelos de contrato'],
  ['portfolios', 'página de portfólio', 'páginas de portfólio'],
  ['catalogProducts', 'produto ou serviço no catálogo', 'produtos e serviços no catálogo'],
  ['stores', 'loja com aplicativo próprio', 'lojas com aplicativo próprio'],
  ['appUsers', 'acesso por aplicativo de loja', 'acessos por aplicativo de loja'],
];

const planValue = (plan, key) => {
  const value = Number(plan[key] || 0);
  if (key === 'appUsers' && Number(plan.stores) < 1) return 'Não incluído';
  if (key === 'catalogProducts' && value === 0) return 'Não incluído';
  if (key === 'stores' && value === 0) return 'Não incluído';
  return value;
};

function PlanFeatures({ plan }) {
  return (
    <ul className="mt-5 grid gap-3 text-sm text-slate-600">
      {PLAN_FEATURES.filter(([key]) => key !== 'appUsers' || Number(plan.stores) > 0).map(([key, singular, plural]) => (
        <li key={key} className="flex items-start gap-2.5">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Icon name="check" size={13} /></span>
          <span>{planValue(plan, key) === 'Não incluído' ? 'Não incluído' : <><strong className="font-semibold text-slate-800">{planValue(plan, key).toLocaleString('pt-BR')}</strong> {planValue(plan, key) === 1 ? singular : plural}</>}</span>
        </li>
      ))}
      {plan.auditSend && <li className="flex items-start gap-2.5"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Icon name="check" size={13} /></span><span>Respostas pela auditoria de conversas</span></li>}
      {plan.tabs?.includes('pedidos') && <li className="flex items-start gap-2.5"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Icon name="check" size={13} /></span><span>Pedidos, clientes e frente de caixa</span></li>}
      {plan.tabs?.includes('api') && <li className="flex items-start gap-2.5"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Icon name="check" size={13} /></span><span>API e webhooks para integrações</span></li>}
    </ul>
  );
}

function DemoPanel() {
  return (
    <SalesPreview />
  );
}

export default function Landing() {
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeFeature, setActiveFeature] = useState('cobrancas');

  async function loadPlans() {
    setLoading(true);
    setError('');
    try {
      setMeta(await api.get('/plans'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPlans(); }, []);

  const trialDays = meta?.trialDays ?? 7;
  const plans = meta?.plans || [];

  return (
    <main className="min-h-screen overflow-hidden bg-white text-slate-900">
      <header className="relative z-10 border-b border-slate-200/70 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/" aria-label="DM Gerenciador - início" className="rounded-lg no-underline"><Brand /></Link>
          <nav className="hidden items-center gap-8 text-sm font-semibold text-slate-600 md:flex" aria-label="Navegação da página">
            <a className="no-underline transition hover:text-slate-950" href="#recursos">Recursos</a>
            <a className="no-underline transition hover:text-slate-950" href="#para-quem">Soluções</a>
            <a className="no-underline transition hover:text-slate-950" href="#planos">Planos</a>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link to="/entrar" className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 no-underline transition hover:bg-slate-100">Entrar</Link>
            <a href="#planos" className="inline-flex min-h-10 items-center justify-center rounded-xl bg-amber-400 px-3 py-2 text-sm font-bold text-slate-950 no-underline shadow-sm transition hover:bg-amber-300 sm:px-5">Começar grátis</a>
          </div>
        </div>
      </header>

      <section className="relative isolate bg-slate-950 text-white">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_75%_35%,rgba(242,163,58,0.2),transparent_38%),linear-gradient(120deg,#0f2238,#152f4c_65%,#0f2238)]" />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:px-8 lg:py-24">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-amber-200 sm:text-sm">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Gestão de negócios, sem complicação
            </span>
            <h1 className="mt-6 text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Sua operação mais organizada.
              <span className="mt-2 block text-amber-300">Seu próximo passo mais perto.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
              Do primeiro atendimento ao pedido pago: centralize clientes, cobranças e lembretes pelo WhatsApp, contratos, presença digital, vendas e automações em uma só plataforma.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#planos" className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-amber-400 px-6 text-base font-bold text-slate-950 no-underline shadow-lg shadow-amber-950/25 transition hover:-translate-y-0.5 hover:bg-amber-300">
                Começar teste grátis de {trialDays} dias <Icon name="right" size={18} />
              </a>
              <a href="#recursos" className="inline-flex min-h-14 items-center justify-center rounded-2xl border border-white/20 px-6 text-base font-semibold text-white no-underline transition hover:bg-white/10">Conhecer recursos</a>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-300">
              <span className="flex items-center gap-2"><Icon name="check" size={16} /> {trialDays} dias para experimentar</span>
              <span className="flex items-center gap-2"><Icon name="check" size={16} /> Opções para negócios e agências</span>
              <span className="flex items-center gap-2"><Icon name="check" size={16} /> Acesse pelo celular ou computador</span>
            </div>
          </div>
          <DemoPanel />
        </div>
      </section>

      <section id="para-quem" className="scroll-mt-20 bg-slate-50 py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-amber-700">Dois caminhos, uma plataforma</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Escolha a solução que combina com o seu negócio</h2>
            <p className="mt-4 text-slate-600">Use o sistema para organizar a sua própria operação ou administre várias empresas com aplicativos separados para cada cliente.</p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <article className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg sm:p-8">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-100 text-amber-800"><Icon name="box" size={23} /></span>
              <p className="mt-5 text-xs font-bold uppercase tracking-wider text-amber-700">Plano para a operação</p>
              <h3 className="mt-1 text-xl font-bold">Lojas e prestadores de serviços</h3>
              <p className="mt-2 leading-7 text-slate-600">Para lojas, clínicas, escritórios de advocacia e profissionais que querem organizar a rotina, vender e atender melhor sem depender de várias ferramentas.</p>
              <ul className="mt-5 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                {['Cobranças e lembretes', 'Contratos estilizados', 'Auditoria WhatsApp', 'Sites e catálogos', 'Produtos, pedidos e PDV', 'APIs e webhooks'].map((item) => <li key={item} className="flex items-center gap-2"><Icon name="check" size={16} />{item}</li>)}
              </ul>
              <Link to="/solucoes/lojas" className="mt-6 inline-flex items-center gap-2 font-bold text-slate-900 no-underline hover:text-amber-700">Saiba mais sobre o plano <Icon name="right" size={16} /></Link>
            </article>
            <article className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg sm:p-8">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-100 text-blue-800"><Icon name="globe" size={23} /></span>
              <p className="mt-5 text-xs font-bold uppercase tracking-wider text-blue-700">Plano para quem gerencia clientes</p>
              <h3 className="mt-1 text-xl font-bold">Agências e empresas de serviços</h3>
              <p className="mt-2 leading-7 text-slate-600">Atenda várias empresas com estruturas separadas e crie um aplicativo para cada cliente trabalhar com as ferramentas do plano de operação.</p>
              <ul className="mt-5 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                {['Tudo do plano de operação', 'Lojas e dados separados', 'Aplicativos por cliente', 'Acessos por permissão', 'Gestão de várias empresas', 'Escala para a agência'].map((item) => <li key={item} className="flex items-center gap-2"><Icon name="check" size={16} />{item}</li>)}
              </ul>
              <Link to="/solucoes/agencias" className="mt-6 inline-flex items-center gap-2 font-bold text-slate-900 no-underline hover:text-blue-700">Saiba mais sobre o plano <Icon name="right" size={16} /></Link>
            </article>
          </div>
        </div>
      </section>

      <section id="recursos" className="scroll-mt-20 py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-amber-700">Tudo conectado</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Ferramentas para cuidar da operação e crescer com organização</h2>
            <p className="mt-4 leading-7 text-slate-600">Selecione uma área para explorar uma simulação visual da tela e entender como ela funciona no sistema.</p>
          </div>
          <div className="mt-9 grid items-start gap-6 lg:grid-cols-[minmax(17rem,0.72fr)_minmax(0,1.28fr)]">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1" role="tablist" aria-label="Funcionalidades do sistema">
              {FEATURES.map(({ key, icon, title, text }) => (
                <button key={key} type="button" role="tab" aria-selected={activeFeature === key} aria-controls="feature-preview" onClick={() => setActiveFeature(key)}
                  className={`group flex min-h-[4.5rem] items-start gap-3 rounded-xl border p-3 text-left transition sm:p-3.5 ${activeFeature === key ? 'border-amber-400 bg-amber-50 shadow-sm' : 'border-slate-200 bg-white hover:border-amber-300 hover:bg-slate-50'}`}>
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${activeFeature === key ? 'bg-amber-400 text-slate-950' : 'bg-slate-100 text-slate-700 group-hover:bg-amber-100'}`}><Icon name={icon} size={18} /></span>
                  <span><strong className="block text-sm text-slate-900">{title}</strong><small className="mt-1 block text-xs leading-5 text-slate-600">{text}</small></span>
                </button>
              ))}
            </div>
            <div id="feature-preview" role="tabpanel" className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div><p className="text-xs font-bold uppercase tracking-wider text-amber-700">Conheça por dentro</p><p className="mt-1 text-sm text-slate-600">Use o menu da prévia para alternar entre as telas.</p></div>
                <span className="hidden rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 sm:inline">Demonstração interativa</span>
              </div>
              <SalesPreview variant="features" activeScreen={activeFeature} onScreenChange={setActiveFeature} />
            </div>
          </div>
        </div>
      </section>

      <section id="planos" className="scroll-mt-20 bg-slate-950 py-16 text-white sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-amber-300">Planos para cada etapa</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Escolha seu plano e comece a testar</h2>
            <p className="mt-4 text-slate-300">Compare os limites de cada opção. Você seleciona o plano no cadastro e começa com {trialDays} dias de teste grátis.</p>
          </div>

          {loading && <p className="mt-10 text-center text-slate-300" role="status">Carregando planos...</p>}
          {error && (
            <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-red-300/30 bg-red-950/40 p-5 text-center" role="alert">
              <p>{error}</p>
              <button type="button" className="mt-4 rounded-xl bg-white px-4 py-2 font-semibold text-slate-900" onClick={loadPlans}>Tentar novamente</button>
            </div>
          )}
          {!loading && !error && !plans.length && <p className="mt-10 text-center text-slate-300">Os planos estarão disponíveis em breve.</p>}

          {!loading && !error && plans.length > 0 && (
            <>
              <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {plans.map((plan, index) => (
                  <article key={plan.id} className={`flex flex-col rounded-3xl border p-6 text-slate-950 shadow-xl shadow-slate-950/10 sm:p-7 ${index === 0 ? 'border-white bg-white' : index === 1 ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div><h3 className="text-xl font-bold text-slate-950">{plan.name}</h3><p className="mt-1 text-sm text-slate-700">{index === 0 ? 'Para organizar a própria operação' : index === 1 ? 'Para gerenciar operações de clientes' : 'Para acompanhar seu negócio'}</p></div>
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: plan.color || '#f2a33a' }} />
                    </div>
                    <p className="mt-6"><strong className="text-4xl font-bold tracking-tight text-slate-950">{brl(plan.priceCents)}</strong><span className="text-slate-600">/mês</span></p>
                    <p className="mt-1 text-sm text-slate-600">Teste por {trialDays} dias antes de decidir.</p>
                    <PlanFeatures plan={plan} />
                    <Link to={`/cadastro?plan=${encodeURIComponent(plan.id)}`} className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 font-bold text-slate-950 no-underline transition hover:bg-amber-300">
                      Escolher {plan.name} <Icon name="right" size={17} />
                    </Link>
                  </article>
                ))}
              </div>
              <div className="mt-8 overflow-hidden rounded-2xl border border-white/15">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
                    <thead><tr className="bg-white/10 text-slate-200"><th className="px-5 py-4 font-semibold">Recursos incluídos</th>{plans.map((p) => <th key={p.id} className="px-5 py-4 font-semibold">{p.name}</th>)}</tr></thead>
                    <tbody>{PLAN_FEATURES.filter(([key]) => key !== 'appUsers' || plans.some((plan) => Number(plan.stores) > 0)).map(([key, , plural]) => (
                      <tr key={key} className="border-t border-white/10">
                        <th scope="row" className="px-5 py-3.5 font-medium text-slate-200">{plural}</th>
                        {plans.map((plan) => {
                          const value = planValue(plan, key);
                          return <td key={plan.id} className="px-5 py-3.5 text-slate-300">{typeof value === 'number' ? value.toLocaleString('pt-BR') : value}</td>;
                        })}
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <p className="bg-white/5 px-5 py-3 text-xs text-slate-400">Os limites e recursos são definidos para cada plano. {plural(trialDays, 'dia de teste disponível', 'dias de teste disponíveis')} antes da contratação.</p>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="bg-amber-400 px-4 py-14 sm:px-6 sm:py-16">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 text-center sm:px-2 md:flex-row md:text-left">
          <div><h2 className="text-3xl font-bold tracking-tight text-slate-950">Pronto para organizar ou expandir?</h2><p className="mt-2 text-slate-800">Crie sua conta e explore o DM Gerenciador por {trialDays} dias.</p></div>
          <Link to={`/cadastro${plans[0] ? `?plan=${encodeURIComponent(plans[0].id)}` : ''}`} className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-6 font-bold text-white no-underline transition hover:bg-slate-800">Começar teste grátis <Icon name="right" size={18} /></Link>
        </div>
      </section>

      <footer className="bg-slate-950 px-4 py-7 text-sm text-slate-400 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 sm:flex-row">
          <Brand light />
          <p>Gestão mais simples para negócios que querem crescer.</p>
          <Link to="/entrar" className="font-semibold text-white no-underline hover:text-amber-300">Já tenho uma conta</Link>
        </div>
      </footer>
    </main>
  );
}
