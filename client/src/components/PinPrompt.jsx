import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';
import { tabLabel } from '../lib/pin.js';

// Digitar só números (4 a 8) no campo de PIN.
export const onlyPinDigits = (v) => v.replace(/\D/g, '').slice(0, 8);

// Cadeado ao lado do nome: abas protegidas por PIN ficam escondidas do menu; ao digitar o PIN elas aparecem por alguns minutos.
export function PinUnlockModal({ onClose }) {
  const { unlockPin } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await unlockPin(pin);
      onClose();
    } catch (err) {
      setError(err.message);
      setPin('');
      setBusy(false);
    }
  }

  return (
    <Modal title="Abas protegidas" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <p className="muted">Digite o código PIN para mostrar as abas escondidas. Elas voltam a ficar escondidas depois de alguns minutos.</p>
        <label className="field">
          <span>Código PIN</span>
          <input className="input pin-input" type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={8} value={pin} onChange={(e) => setPin(onlyPinDigits(e.target.value))} aria-label="Código PIN" />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || pin.length < 4}>{busy ? 'Verificando...' : 'Mostrar abas'}</button>
        <button type="button" className="link-btn" onClick={() => setForgot(true)}>Esqueci o código PIN</button>
      </form>
      {forgot && <ForgotPinModal onClose={() => setForgot(false)} />}
    </Modal>
  );
}

// Tela que aparece no lugar de uma aba protegida: pede o código PIN.
export default function PinPrompt({ tab }) {
  const { unlockPin } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await unlockPin(pin);
    } catch (err) {
      setError(err.message);
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pin-wrap">
      <form className="card pin-card" onSubmit={submit} noValidate>
        <span className="pin-icon"><Icon name="lock" size={28} /></span>
        <h1>Aba protegida</h1>
        <p className="muted">A aba <strong>{tabLabel(tab)}</strong> está protegida por código PIN. Digite o código para abrir.</p>
        <label className="field">
          <span>Código PIN</span>
          <input className="input pin-input" type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={8} value={pin} onChange={(e) => setPin(onlyPinDigits(e.target.value))} aria-label="Código PIN" />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || pin.length < 4}>{busy ? 'Verificando...' : 'Desbloquear'}</button>
        <button type="button" className="link-btn" onClick={() => setForgot(true)}>Esqueci o código PIN</button>
      </form>
      {forgot && <ForgotPinModal onClose={() => setForgot(false)} />}
    </div>
  );
}

// Esqueci o código PIN: confirma a conta (e-mail ou CPF/CNPJ), recebe um código no WhatsApp e cria um PIN novo (ou remove o PIN).
export function ForgotPinModal({ onClose }) {
  const { applyPin } = useAuth();
  const [step, setStep] = useState(1);
  const [identifier, setIdentifier] = useState('');
  const [hint, setHint] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
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
      const r = await api.post('/auth/pin/forgot', { identifier });
      setHint(r.phoneHint || '');
      setStep(2);
    });
  };
  const finish = (newPin) => run(async () => {
    const r = await api.post('/auth/pin/reset', { code, ...(newPin ? { pin: newPin } : {}) });
    applyPin(r);
    onClose();
  });

  return (
    <Modal title="Esqueci o código PIN" onClose={onClose}>
      {step === 1 ? (
        <form className="form" onSubmit={sendCode} noValidate>
          <p className="muted">Para confirmar que é você, informe o e-mail ou o CPF/CNPJ da sua conta. Enviaremos um código para o WhatsApp cadastrado.</p>
          <label className="field">
            <span>E-mail ou CPF/CNPJ</span>
            <input className="input" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy || !identifier.trim()}>{busy ? 'Enviando...' : 'Enviar código pelo WhatsApp'}</button>
        </form>
      ) : (
        <div className="form">
          <p className="muted">Enviamos um código de 6 números para o seu WhatsApp{hint ? ` (${hint})` : ''}. Ele vale por 10 minutos.</p>
          <label className="field">
            <span>Código recebido</span>
            <input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoFocus />
          </label>
          <label className="field">
            <span>Novo código PIN (4 a 8 números)</span>
            <input className="input" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} onChange={(e) => setPin(onlyPinDigits(e.target.value))} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6 || pin.length < 4} onClick={() => finish(pin)}>Salvar novo PIN</button>
          <button className="btn btn-ghost btn-block" disabled={busy || code.length !== 6} onClick={() => finish('')}>Remover o PIN</button>
        </div>
      )}
    </Modal>
  );
}
