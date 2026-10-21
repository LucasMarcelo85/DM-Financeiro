import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { AuthShell } from './Login.jsx';

// Esqueci a senha: informa e-mail ou CPF/CNPJ, recebe um código no WhatsApp (enviado pela conexão do administrador) e cria a nova senha.
export default function ForgotPassword() {
  const [step, setStep] = useState(1);
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const sendCode = (e) => {
    e.preventDefault();
    run(async () => {
      await api.post('/auth/forgot', { identifier });
      setStep(2);
    });
  };

  const reset = (e) => {
    e.preventDefault();
    if (password !== password2) return setError('A confirmação da senha não confere.');
    return run(async () => {
      await api.post('/auth/reset', { identifier, code, password });
      setStep(3);
    });
  };

  if (step === 3) {
    return (
      <AuthShell title="Senha alterada" subtitle="Tudo certo! Agora é só entrar com a nova senha.">
        <Link className="btn btn-primary btn-block" to="/entrar">Ir para o login</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Esqueci a senha" subtitle={step === 1 ? 'Informe seu e-mail ou CPF/CNPJ. Enviaremos um código para o WhatsApp cadastrado na conta.' : 'Se os dados estiverem certos e a conta tiver WhatsApp cadastrado, o código chega em instantes. Ele vale por 10 minutos.'}>
      {step === 1 ? (
        <form onSubmit={sendCode} className="form" noValidate>
          <label className="field">
            <span>E-mail ou CPF/CNPJ</span>
            <input className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoFocus required />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy || !identifier.trim()}>{busy ? 'Enviando...' : 'Enviar código pelo WhatsApp'}</button>
        </form>
      ) : (
        <form onSubmit={reset} className="form" noValidate>
          <label className="field">
            <span>Código recebido no WhatsApp</span>
            <input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus required />
          </label>
          <label className="field">
            <span>Nova senha (mínimo 8 caracteres)</span>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          </label>
          <label className="field">
            <span>Repita a nova senha</span>
            <input className="input" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" required />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6 || password.length < 8 || !password2}>{busy ? 'Salvando...' : 'Alterar senha'}</button>
          <button type="button" className="link-btn" onClick={() => { setStep(1); setError(''); }}>Não recebi o código</button>
        </form>
      )}
      <p className="auth-switch"><Link to="/entrar">Voltar ao login</Link></p>
    </AuthShell>
  );
}
