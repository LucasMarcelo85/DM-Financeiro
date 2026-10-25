import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import Icon from './Icon.jsx';
import PlanBadge from './PlanBadge.jsx';
import PinPrompt from './PinPrompt.jsx';
import { isTabLocked, tabOfPath } from '../lib/pin.js';

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
  { to: '/plano', label: 'Plano', icon: 'card', always: true },
  { to: '/perfil', label: 'Perfil', icon: 'gear', always: true },
];

export function Brand({ light }) {
  return (
    <span className={`brand ${light ? 'brand-light' : ''}`}>
      <span className="brand-mark">DM</span>
      <span className="brand-name">Financeiro</span>
    </span>
  );
}

export default function Layout() {
  const { user, logout, pinUnlocked } = useAuth();
  const { pathname } = useLocation();
  const [openOrders, setOpenOrders] = useState(0);
  const base = NAV.filter((i) => i.feature !== 'catalog' || (user.limits?.catalogProducts ?? 0) > 0); // Produtos e Pedidos só nos planos com catálogo digital
  const items = user.role === 'admin'
    ? [...base, { to: '/admin', label: 'Usuários', icon: 'users', always: true, end: true }, { to: '/admin/planos', label: 'Gerir planos', icon: 'tag', always: true }]
    : base;
  // Aba protegida por código PIN e ainda não destravada: mostra o pedido do PIN no lugar da página.
  const tab = tabOfPath(pathname);
  const locked = isTabLocked(user, pinUnlocked, tab);
  const blocked = !user.access.hasAccess;

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
            <strong title={user.name}>{user.name}</strong>
            {user.role === 'admin' ? <span className="badge plan-admin">Admin</span> : <PlanBadge plan={user.plan} name={user.planName} color={user.planColor} />}
          </div>
          <button className="btn btn-ghost-light btn-sm" onClick={logout}>
            <Icon name="logout" size={16} /> Sair
          </button>
        </div>
      </aside>

      <main className="main">
        <div className={`page ${pathname.startsWith('/auditoria') ? 'page-wide' : ''}`}>
          {locked ? <PinPrompt tab={tab} /> : <Outlet />}
        </div>
      </main>
    </div>
  );
}
