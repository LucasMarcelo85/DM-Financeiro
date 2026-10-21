import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Brand } from '../components/Layout.jsx';
import Lamp from '../components/Lamp.jsx';

export function AuthShell({ title, subtitle, children }) {
  return (
    <div className="auth">
      <aside className="auth-aside">
        <Brand light />
        <div className="auth-pitch">
          <h2>Cobre seus clientes direto no WhatsApp</h2>
          <ul>
            <li>Mensagem com link ou Pix em dois blocos, fácil de copiar e colar</li>
            <li>Lembretes de vencimento sem sair da tela</li>
            <li>Teste grátis, sem cartão de crédito</li>
          </ul>
        </div>
        <p className="auth-live">
          <Lamp on size="sm" /> WhatsApp conectado em um minuto, lendo um QR Code
        </p>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-mobile-brand">
            <Brand />
          </div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(identifier, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Entrar" subtitle="Use seu e-mail ou CPF/CNPJ e a senha cadastrada.">
      <form onSubmit={submit} className="form" noValidate>
        <label className="field">
          <span>E-mail ou CPF/CNPJ</span>
          <input className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label className="field">
          <span className="field-line"><span>Senha</span><Link to="/esqueci-senha" className="field-link">Esqueci a senha</Link></span>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || !identifier || !password}>
          {busy ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
      <p className="auth-switch">
        Ainda não tem conta? <Link to="/cadastro">Criar conta grátis</Link>
      </p>
    </AuthShell>
  );
}
