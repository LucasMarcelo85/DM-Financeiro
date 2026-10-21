import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Icon from './Icon.jsx';
import PlanBadge from './PlanBadge.jsx';

const NAV = [
  { to: '/', label: 'Início', icon: 'home', end: true },
  { to: '/whatsapp', label: 'WhatsApp', icon: 'chat' },
  { to: '/clientes', label: 'Clientes', icon: 'user' },
  { to: '/cobrancas', label: 'Cobranças', icon: 'money' },
  { to: '/lembretes', label: 'Lembretes', icon: 'bell' },
  { to: '/contratos', label: 'Contratos', icon: 'file' },
  { to: '/auditoria', label: 'Auditoria', icon: 'eye' },
  { to: '/portfolio', label: 'Portfólio', icon: 'globe' },
  { to: '/plano', label: 'Plano', icon: 'card', always: true },
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
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const items = user.role === 'admin' ? [...NAV, { to: '/admin', label: 'Usuários', icon: 'users', always: true }] : NAV;
  const blocked = !user.access.hasAccess;

  // No celular a barra de baixo rola: mantém o item da página atual à vista.
  useEffect(() => {
    document.querySelector('.nav-link.is-active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [pathname]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <Brand light />
          <button className="btn btn-ghost-light btn-sm topbar-logout" onClick={logout}>
            <Icon name="logout" size={16} /> Sair
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
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </NavLink>
            )
          )}
        </nav>

        <div className="sidebar-user">
          <div className="sidebar-user-info">
            <strong title={user.name}>{user.name}</strong>
            {user.role === 'admin' ? <span className="badge plan-admin">Admin</span> : <PlanBadge plan={user.plan} />}
          </div>
        </div>
      </aside>

      <main className="main">
        <div className={`page ${pathname.startsWith('/auditoria') ? 'page-wide' : ''}`}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
