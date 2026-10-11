import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AuthShell } from './Login.jsx';
import { brl, maskDoc, maskPhone, plural } from '../lib/format.js';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [meta, setMeta] = useState(null);
  const [kind, setKind] = useState('PF');
  const [form, setForm] = useState({ name: '', document: '', email: '', phone: '', password: '', confirm: '', plan: 'bronze' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/plans').then(setMeta).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const isPF = kind === 'PF';

  function changeKind(next) {
    setKind(next);
    setForm((f) => ({ ...f, document: '' }));
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) return setError('As senhas não são iguais.');
    setBusy(true);
    try {
      await register({ kind, name: form.name, document: form.document, email: form.email, phone: form.phone, password: form.password, plan: form.plan });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const trial = meta ? plural(meta.trialDays, 'dia', 'dias') : '3 dias';

  return (
    <AuthShell title="Criar conta" subtitle={`Teste grátis por ${trial}. Depois, é só pagar pelo link para continuar.`}>
      <form onSubmit={submit} className="form" noValidate>
        <div className="seg" role="radiogroup" aria-label="Tipo de conta">
          <button type="button" role="radio" aria-checked={isPF} className={isPF ? 'is-on' : ''} onClick={() => changeKind('PF')}>
            Pessoa física
          </button>
          <button type="button" role="radio" aria-checked={!isPF} className={!isPF ? 'is-on' : ''} onClick={() => changeKind('PJ')}>
            Pessoa jurídica
          </button>
        </div>

        <label className="field">
          <span>{isPF ? 'Nome completo' : 'Razão social'}</span>
          <input className="input" value={form.name} onChange={set('name')} autoComplete={isPF ? 'name' : 'organization'} required />
        </label>

        <div className="form-row">
          <label className="field">
            <span>{isPF ? 'CPF' : 'CNPJ'}</span>
            <input
              className="input"
              inputMode="numeric"
              value={form.document}
              onChange={(e) => setForm((f) => ({ ...f, document: maskDoc(e.target.value, kind) }))}
              placeholder={isPF ? '000.000.000-00' : '00.000.000/0000-00'}
              required
            />
            <small>Será o nome do seu WhatsApp conectado.</small>
          </label>
          <label className="field">
            <span>Telefone</span>
            <input className="input" type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: maskPhone(e.target.value) }))} placeholder="(85) 99999-9999" autoComplete="tel-national" />
          </label>
        </div>

        <label className="field">
          <span>E-mail</span>
          <input className="input" type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
        </label>

        <div className="form-row">
          <label className="field">
            <span>Senha</span>
            <input className="input" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" minLength={8} required />
            <small>Mínimo de 8 caracteres.</small>
          </label>
          <label className="field">
            <span>Repita a senha</span>
            <input className="input" type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required />
          </label>
        </div>

        <fieldset className="field plan-pick">
          <legend>Plano depois do teste grátis</legend>
          <div className="plan-pick-grid">
            {(meta?.plans || []).map((p) => (
              <label key={p.id} className={`plan-opt plan-opt-${p.id} ${form.plan === p.id ? 'is-on' : ''}`}>
                <input type="radio" name="plan" value={p.id} checked={form.plan === p.id} onChange={set('plan')} />
                <strong>{p.name}</strong>
                <span>{brl(p.priceCents)}/mês</span>
                <small>
                  {plural(p.instances, 'WhatsApp', 'WhatsApps')} · {plural(p.contracts, 'contrato', 'contratos')}
                </small>
              </label>
            ))}
          </div>
        </fieldset>

        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Criando conta...' : `Começar teste grátis de ${trial}`}
        </button>
      </form>
      <p className="auth-switch">
        Já tem conta? <Link to="/entrar">Entrar</Link>
      </p>
    </AuthShell>
  );
}
