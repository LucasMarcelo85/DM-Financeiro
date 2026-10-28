import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import PlanBadge from './PlanBadge.jsx';
import PinPrompt, { PinUnlockModal } from './PinPrompt.jsx';
import { isTabInPlan, isTabLocked, tabOfPath } from '../lib/pin.js';

const NAV = [
  { to: '/', label: 'Início', icon: 'home', end: true },
  { to: '/whatsapp', label: 'WhatsApp', icon: 'chat' },
  { to: '/clientes', label: 'Clientes', icon: 'user' },
  { to: '/cobrancas', label: 'Cobranças', icon: 'money' },
  { to: '/lembretes', label: 'Lembretes', icon: 'bell' },
  { to: '/contratos', label: 'Contratos', icon: 'file' },
  { to: '/auditoria', label: 'Auditoria', icon: 'eye' },
  { to: '/portfolio', label: 'Portfólio', icon: 'globe' },
  { to: '/produtos', label: 'Produtos', icon: 'box', feature: 'catalog' },
  { to: '/pedidos', label: 'Pedidos', icon: 'receipt', feature: 'catalog' },
  { to: '/api', label: 'API', icon: 'link' },
  { to: '/plano', label: 'Plano', icon: 'card', always: true },
  { to: '/perfil', label: 'Perfil', icon: 'gear', always: true },
];

export function Brand({ light }) {
  return (
    <span className={`brand ${light ? 'brand-light' : ''}`}>
      <span className="brand-mark">DM</span>
      <span className="brand-name">Gerenciador</span>
    </span>
  );
}

// Cadeado: com o PIN ativo, mostra ou esconde as abas protegidas.
function PinToggle({ className = '' }) {
  const { user, pinUnlocked, lockPin } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user.pin?.enabled) return null;
  const label = pinUnlocked ? 'Esconder abas protegidas' : 'Mostrar abas protegidas (pede o PIN)';
  return (
    <>
      <button type="button" className={`icon-btn pin-toggle ${className}`} onClick={() => (pinUnlocked ? lockPin() : setOpen(true))} aria-label={label} title={label}>
        <Icon name={pinUnlocked ? 'unlock' : 'lock'} size={18} />
      </button>
      {open && <PinUnlockModal onClose={() => setOpen(false)} />}
    </>
  );
}

export default function Layout() {
  const { user, logout, pinUnlocked } = useAuth();
  const { pathname } = useLocation();
  const [openOrders, setOpenOrders] = useState(0);
  const base = NAV.filter((i) => i.feature !== 'catalog' || (user.limits?.catalogProducts ?? 0) > 0); // Produtos e Pedidos só nos planos com catálogo digital
  const all = user.role === 'admin'
    ? [...base, { to: '/admin', label: 'Usuários', icon: 'users', always: true, end: true }, { to: '/admin/planos', label: 'Gerir planos', icon: 'tag', always: true }]
    : base;
  // Abas fora do plano ou protegidas por PIN (ainda travadas) não aparecem no menu.
  const planOrder = user?.limits?.tabs || [];
  const items = all
    .filter((i) => isTabInPlan(user, tabOfPath(i.to)) && !isTabLocked(user, pinUnlocked, tabOfPath(i.to)))
    .sort((a, b) => {
      const aIndex = planOrder.indexOf(tabOfPath(a.to));
      const bIndex = planOrder.indexOf(tabOfPath(b.to));
      return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex);
    });
  // Aba protegida por código PIN e ainda não destravada: mostra o pedido do PIN no lugar da página.
  const tab = tabOfPath(pathname);
  const locked = isTabLocked(user, pinUnlocked, tab);
  const outOfPlan = !isTabInPlan(user, tab);
  const blocked = !user.access.hasAccess;
  const fallbackPath = all.find((item) => isTabInPlan(user, tabOfPath(item.to)) && !isTabLocked(user, pinUnlocked, tabOfPath(item.to)))?.to || '/perfil';

  useEffect(() => {
    if ((user.limits?.catalogProducts ?? 0) < 1) return undefined;
    let alive = true;
    const refresh = () => api.get('/catalog/orders')
      .then((r) => { if (alive) setOpenOrders(r.fresh || 0); })
      .catch((e) => console.error('[menu] não foi possível atualizar o contador de pedidos:', e.message));
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, [user.limits?.catalogProducts]);

  // No celular a barra de baixo rola: mantém o item da página atual à vista.
  useEffect(() => {
    document.querySelector('.nav-link.is-active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [pathname]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <Brand light />
          <PinToggle className="topbar-pin" />
          <button className="icon-btn topbar-logout" onClick={logout} aria-label="Sair">
            <Icon name="logout" />
          </button>
        </div>

        <nav className="nav" aria-label="Menu principal">
          {items.map((item) =>
            blocked && !item.always ? (
              <span key={item.to} className="nav-link is-locked" aria-disabled="true" title="Faça o pagamento para liberar">
                <Icon name={item.icon} />
                <span>{item.label}</span>
                <Icon name="lock" size={14} />
              </span>
            ) : (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}>
                {item.to === '/pedidos' && openOrders > 0
                  ? <span className="nav-icon-notice"><Icon name={item.icon} /><i>{openOrders > 99 ? '99+' : openOrders}</i></span>
                  : <Icon name={item.icon} />}
                <span>{item.label}</span>
              </NavLink>
            )
          )}
        </nav>

        <div className="sidebar-user">
          <div className="sidebar-user-info">
            <span className="sidebar-user-name"><strong title={user.name}>{user.name}</strong><PinToggle className="side-pin" /></span>
            {user.role === 'admin' ? <span className="badge plan-admin">Admin</span> : <PlanBadge plan={user.plan} name={user.planName} color={user.planColor} />}
          </div>
          <button className="btn btn-ghost-light btn-sm" onClick={logout}>
            <Icon name="logout" size={16} /> Sair
          </button>
        </div>
      </aside>

      <main className="main">
        <div className={`page ${pathname.startsWith('/auditoria') || pathname.startsWith('/produtos') ? 'page-wide' : ''}`}>
          {outOfPlan ? <Navigate to={fallbackPath} replace /> : locked ? <PinPrompt tab={tab} /> : <Outlet />}
        </div>
      </main>
    </div>
  );
}
