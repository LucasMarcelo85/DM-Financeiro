import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import WhatsApp from './pages/WhatsApp.jsx';
import { Charge, Reminder } from './pages/Messaging.jsx';
import Billing from './pages/Billing.jsx';
import PaymentReturn from './pages/PaymentReturn.jsx';
import Contracts from './pages/Contracts.jsx';
import Admin from './pages/Admin.jsx';

const OPEN_WHEN_BLOCKED = ['/plano', '/pagamento/retorno', '/admin'];

function Splash() {
  return (
    <div className="splash">
      <span className="lamp lamp-lg is-pending" />
    </div>
  );
}

function Protected() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/entrar" replace />;
  if (!user.access.hasAccess && !OPEN_WHEN_BLOCKED.includes(pathname)) return <Navigate to="/plano" replace />;
  return <Layout />;
}

function GuestOnly() {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}

function AdminOnly() {
  const { user } = useAuth();
  return user.role === 'admin' ? <Outlet /> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/entrar" element={<Login />} />
        <Route path="/cadastro" element={<Register />} />
      </Route>
      <Route element={<Protected />}>
        <Route index element={<Dashboard />} />
        <Route path="whatsapp" element={<WhatsApp />} />
        <Route path="cobranca" element={<Charge />} />
        <Route path="lembrete" element={<Reminder />} />
        <Route path="contratos" element={<Contracts />} />
        <Route path="plano" element={<Billing />} />
        <Route path="pagamento/retorno" element={<PaymentReturn />} />
        <Route element={<AdminOnly />}>
          <Route path="admin" element={<Admin />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
