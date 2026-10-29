import { Link, Navigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Brand } from '../components/Layout.jsx';
import SalesPreview from '../components/SalesPreview.jsx';

const SOLUTIONS = {
  lojas: {
    eyebrow: 'Plano para lojas e prestadores de serviços',
    title: 'Cuide da operação e do atendimento em um só lugar.',
    intro: 'Organize o relacionamento com clientes, automatize tarefas de cobrança e acompanhe vendas presenciais e online — para sua equipe trabalhar com mais clareza.',
    features: [
      ['Cobranças e lembretes', 'Organize vencimentos e comunique-se pelo WhatsApp conectado à sua operação.'],
      ['Contratos', 'Monte contratos padronizados e estilizados com os dados de cada cliente.'],
      ['Auditoria', 'Supervisione conversas das conexões autorizadas e acompanhe o atendimento.'],
      ['Portfólio digital', 'Crie sites, catálogos e páginas para apresentar produtos e serviços.'],
      ['Produtos, pedidos e PDV', 'Mantenha o catálogo organizado e registre vendas online ou no caixa.'],
      ['APIs e webhooks', 'Conecte o sistema a outras ferramentas e crie automações para sua rotina.'],
    ],
    steps: [
      ['Organize', 'Cadastre clientes, produtos, serviços e modelos de contrato.'],
      ['Atenda e venda', 'Compartilhe suas páginas, receba pedidos e registre vendas no PDV.'],
      ['Acompanhe', 'Consulte cobranças, mensagens e resultados para decidir seus próximos passos.'],
    ],
    audience: 'Lojas físicas e virtuais, clínicas, escritórios de advocacia e outros prestadores que precisam reunir atendimento e gestão.',
    cta: 'Conhecer os planos para minha operação',
  },
  agencias: {
    eyebrow: 'Plano para agências e empresas de serviços',
    title: 'Gerencie operações de clientes sem misturar os dados.',
    intro: 'Além de usar as ferramentas da plataforma, sua agência pode criar aplicativos próprios para cada empresa atendida. Cada cliente acessa sua operação com as permissões definidas para ele.',
    features: [
      ['Tudo do plano de operação', 'Acesse os recursos para clientes, cobranças, contratos, auditoria, páginas, vendas e integrações.'],
      ['Estrutura por empresa', 'Separe lojas, produtos, pedidos e configurações de cada cliente atendido.'],
      ['Aplicativos para clientes', 'Crie um app de loja com identidade visual própria e um endereço compartilhável.'],
      ['Acessos com permissões', 'Defina quais áreas cada pessoa pode consultar ou administrar no aplicativo.'],
      ['WhatsApp do criador', 'Configure o contato da agência para receber notificações de pedidos das operações.'],
      ['Mais capacidade de atendimento', 'Acompanhe várias empresas em uma estrutura preparada para crescer com sua carteira.'],
    ],
    steps: [
      ['Crie a operação do cliente', 'Configure a loja, o catálogo, as conexões e o aplicativo.'],
      ['Defina os acessos', 'Escolha as áreas e os usuários que poderão trabalhar no app.'],
      ['Acompanhe de perto', 'Cada empresa opera no próprio espaço enquanto sua equipe mantém a gestão centralizada.'],
    ],
    audience: 'Agências digitais, consultorias e empresas de serviços que implantam ferramentas e administram a operação de outras empresas.',
    cta: 'Conhecer os planos para agências',
  },
};

export default function SalesDetails() {
  const { audience } = useParams();
  const solution = SOLUTIONS[audience];
  if (!solution) return <Navigate to="/" replace />;

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/" aria-label="DM Gerenciador - início" className="rounded-lg no-underline"><Brand /></Link>
          <nav className="flex items-center gap-3 text-sm font-semibold">
            <Link to="/#recursos" className="hidden text-slate-600 no-underline hover:text-slate-950 sm:inline">Recursos</Link>
            <Link to="/#planos" className="rounded-xl bg-amber-400 px-4 py-2 text-slate-950 no-underline hover:bg-amber-300">Planos</Link>
          </nav>
        </div>
      </header>

      <section className="bg-slate-950 text-white">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-amber-300">{solution.eyebrow}</p>
            <h1 className="mt-4 max-w-4xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{solution.title}</h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">{solution.intro}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/#planos" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-amber-400 px-5 font-bold text-slate-950 no-underline hover:bg-amber-300">{solution.cta}<Icon name="right" size={17} /></Link>
              <Link to="/cadastro" className="inline-flex min-h-12 items-center rounded-xl border border-white/25 px-5 font-semibold text-white no-underline hover:bg-white/10">Começar teste grátis</Link>
            </div>
          </div>
          <SalesPreview variant={audience === 'agencias' ? 'agency' : 'business'} />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-amber-700">O que você pode fazer</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Ferramentas conectadas à sua rotina</h2>
        </div>
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {solution.features.map(([title, text]) => (
            <article key={title} className="rounded-2xl border border-slate-200 p-5 sm:p-6">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-800"><Icon name="check" size={20} /></span>
              <h3 className="mt-4 font-bold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 md:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-amber-700">Como funciona</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">Da configuração ao acompanhamento</h2>
            <p className="mt-4 leading-7 text-slate-600">{solution.audience}</p>
          </div>
          <ol className="grid gap-4">
            {solution.steps.map(([title, text], index) => (
              <li key={title} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-950 font-bold text-white">{index + 1}</span>
                <span><strong>{title}</strong><span className="mt-1 block text-sm leading-6 text-slate-600">{text}</span></span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-amber-400 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-5 text-center sm:flex-row sm:text-left">
          <div><h2 className="text-2xl font-bold">Veja qual plano combina com seu momento.</h2><p className="mt-2 text-slate-800">Compare recursos e limites antes de começar seu teste.</p></div>
          <Link to="/#planos" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-slate-950 px-5 font-bold text-white no-underline hover:bg-slate-800">Ver planos <Icon name="right" size={17} /></Link>
        </div>
      </section>
    </main>
  );
}
