import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api } from '../api.js';
import { AuthContext } from '../auth.jsx';
import WhatsApp from '../pages/WhatsApp.jsx';
import Contacts from '../pages/Contacts.jsx';
import Schedules from '../pages/Schedules.jsx';
import ScheduleForm from '../pages/ScheduleForm.jsx';
import Contracts from '../pages/Contracts.jsx';
import ContractEditor from '../pages/ContractEditor.jsx';
import Portfolios from '../pages/Portfolios.jsx';
import PortfolioEditor from '../pages/PortfolioEditor.jsx';
import AiService from '../pages/AiService.jsx';
import { ToastProvider } from './Toast.jsx';

export const WORKSPACE_TABS = ['whatsapp', 'contatos', 'cobrancas', 'contratos', 'portfolio', 'ia'];

const START = { whatsapp: '/whatsapp', contatos: '/clientes', cobrancas: '/cobrancas', contratos: '/contratos', portfolio: '/portfolio', ia: '/ia' };

// Editores precisam da tela inteira, como no painel.
const Full = ({ children }) => <div className="ws-fullscreen">{children}</div>;

// Mostra uma área do painel dentro do app. Ela roda em uma árvore React própria, com roteador
// em memória, porque o app já está dentro do BrowserRouter (roteadores não podem ser aninhados).
export default function WorkspaceSection({ area }) {
  const host = useRef(null);
  useEffect(() => {
    const node = document.createElement('div');
    host.current.appendChild(node);
    const root = createRoot(node);
    root.render(<ToastProvider><Workspace area={area} /></ToastProvider>);
    return () => {
      setTimeout(() => { root.unmount(); node.remove(); });
    };
  }, [area]);
  return <div ref={host} />;
}

function Workspace({ area }) {
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setUser(null);
    api.get('/shop-app/ws/me').then((r) => { if (active) setUser(r.user); }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);

  const auth = useMemo(() => ({
    user, loading: false, setUser, refresh: async () => user, pinUnlocked: true, pinUntil: null,
    unlockPin: async () => {}, lockPin: async () => {}, applyPin: () => {},
  }), [user]);

  if (error) return <p className="form-error">{error}</p>;
  if (!user) return <p className="muted">Carregando...</p>;

  return (
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[START[area]]}>
        <Routes>
          <Route path="/whatsapp" element={<WhatsApp />} />
          <Route path="/clientes" element={<Contacts />} />
          <Route path="/cobrancas" element={<Schedules key="c" kind="cobranca" />} />
          <Route path="/cobrancas/nova" element={<ScheduleForm key="c-new" kind="cobranca" />} />
          <Route path="/cobrancas/:id" element={<ScheduleForm key="c-edit" kind="cobranca" />} />
          <Route path="/contratos" element={<Contracts />} />
          <Route path="/contratos/:id" element={<Full><ContractEditor /></Full>} />
          <Route path="/portfolio" element={<Portfolios />} />
          <Route path="/portfolio/:id" element={<Full><PortfolioEditor /></Full>} />
          <Route path="/portfolio/:id/canvas" element={<Full><PortfolioEditor /></Full>} />
          <Route path="/portfolio/:id/blocks" element={<Full><PortfolioEditor /></Full>} />
          <Route path="/ia" element={<AiService />} />
          <Route path="*" element={<Navigate to={START[area]} replace />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}
