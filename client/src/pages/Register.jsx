import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import { AuthShell } from './Login.jsx';
import { brl, maskDoc, maskPhone, plural } from '../lib/format.js';

const PLAN_FEATURES = [
  ['instances', 'conexão para cobranças', 'conexões para cobranças'],
  ['auditInstances', 'conexão para auditoria', 'conexões para auditoria'],
  ['contracts', 'modelo de contrato', 'modelos de contrato'],
  ['portfolios', 'página de portfólio', 'páginas de portfólio'],
  ['catalogProducts', 'produto ou serviço', 'produtos e serviços'],
  ['stores', 'loja com aplicativo', 'lojas com aplicativo'],
];

function planLimit(plan, key, singular, plural) {
  const count = Number(plan[key] || 0);
  if ((key === 'catalogProducts' || key === 'stores') && count === 0) return 'Não incluído';
  return count ? `${count.toLocaleString('pt-BR')} ${count === 1 ? singular : plural}` : 'Não incluído';
}

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [meta, setMeta] = useState(null);
  const [kind, setKind] = useState('PF');
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ name: '', document: '', email: '', phone: '', password: '', confirm: '', plan: search.get('plan') || '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const errorRef = useRef(null);

  const loadPlans = useCallback(async () => {
    setError('');
    try {
      setMeta(await api.get('/plans'));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);

  useEffect(() => {
    if (!meta?.plans.length) return;
    setForm((current) => ({
      ...current,
      plan: meta.plans.some((plan) => plan.id === current.plan) ? current.plan : meta.plans[0].id,
    }));
  }, [meta]);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const isPF = kind === 'PF';
  const trial = plural(meta?.trialDays ?? 7, 'dia', 'dias');

  function changeKind(next) {
    setKind(next);
    setForm((current) => ({ ...current, document: '' }));
  }

  function continueToPlans(event) {
    event.preventDefault();
    setError('');
    if (form.password !== form.confirm) {
      setError('As senhas não são iguais.');
      return;
    }
    setStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!form.plan || !meta?.plans.some((plan) => plan.id === form.plan)) {
      setError('Escolha um plano para continuar.');
      return;
    }
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

  const selectedPlan = meta?.plans.find((plan) => plan.id === form.plan);

  return (
    <AuthShell title={step === 1 ? 'Crie sua conta' : 'Escolha seu plano'} subtitle={step === 1 ? `Comece com ${trial} de teste grátis. Primeiro, conte como podemos identificar sua conta.` : `Compare os recursos e escolha o plano para começar seus ${trial} de teste.`}>
      <div className="mb-1 flex items-center gap-3" aria-label={`Etapa ${step} de 2`}>
        {[1, 2].map((number) => (
          <div key={number} className="flex flex-1 items-center gap-2">
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${step >= number ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-500'}`}>{step > number ? <Icon name="check" size={16} /> : number}</span>
            <span className={`text-xs font-semibold sm:text-sm ${step >= number ? 'text-slate-900' : 'text-slate-500'}`}>{number === 1 ? 'Seus dados' : 'Plano'}</span>
            {number === 1 && <span className="h-px flex-1 bg-slate-200" />}
          </div>
        ))}
      </div>

      <form onSubmit={step === 1 ? continueToPlans : submit} className="form">
        {step === 1 ? (
          <>
            <div className="seg" role="radiogroup" aria-label="Tipo de conta">
              <button type="button" role="radio" aria-checked={isPF} className={isPF ? 'is-on' : ''} onClick={() => changeKind('PF')}>Pessoa física</button>
              <button type="button" role="radio" aria-checked={!isPF} className={!isPF ? 'is-on' : ''} onClick={() => changeKind('PJ')}>Pessoa jurídica</button>
            </div>

            <label className="field">
              <span>{isPF ? 'Nome completo' : 'Razão social'}</span>
              <input className="input" value={form.name} onChange={set('name')} autoComplete={isPF ? 'name' : 'organization'} minLength={3} maxLength={120} required />
            </label>

            <div className="form-row">
              <label className="field">
                <span>{isPF ? 'CPF' : 'CNPJ'}</span>
                <input className="input" inputMode="numeric" value={form.document}
                  onChange={(event) => setForm((current) => ({ ...current, document: maskDoc(event.target.value, kind) }))}
                  placeholder={isPF ? '000.000.000-00' : '00.000.000/0000-00'} required />
              </label>
              <label className="field">
                <span>Telefone <small>(opcional)</small></span>
                <input className="input" type="tel" inputMode="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: maskPhone(event.target.value) }))} placeholder="(85) 99999-9999" autoComplete="tel-national" />
              </label>
            </div>

            <label className="field">
              <span>E-mail</span>
              <input className="input" type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
            </label>

            <div className="form-row">
              <label className="field">
                <span>Senha</span>
                <input className="input" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" minLength={8} maxLength={72} required />
                <small>Mínimo de 8 caracteres.</small>
              </label>
              <label className="field">
                <span>Repita a senha</span>
                <input className="input" type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required />
              </label>
            </div>

            {error && <div ref={errorRef} className="form-error" role="alert"><p>{error}</p>{!meta && <button type="button" className="link-btn mt-2" onClick={loadPlans}>Tentar carregar os planos novamente</button>}</div>}
            <button type="submit" className="btn btn-primary btn-block">Continuar para escolher o plano <Icon name="right" size={17} /></button>
          </>
        ) : (
          <>
            {!meta && !error && <p className="muted" role="status">Carregando planos...</p>}
            {meta?.plans.length > 0 && (
              <fieldset className="field">
                <legend className="mb-1 text-base font-bold text-slate-900">Qual plano combina com seu negócio?</legend>
                <p className="muted small">A escolha define os recursos disponíveis. Você poderá começar a usar assim que criar sua conta.</p>
                <div className="mt-3 grid gap-3">
                  {meta.plans.map((plan) => (
                    <label key={plan.id} className={`cursor-pointer rounded-2xl border-2 p-4 transition ${form.plan === plan.id ? 'border-amber-400 bg-amber-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                      <input className="sr-only" type="radio" name="plan" value={plan.id} checked={form.plan === plan.id} onChange={set('plan')} />
                      <span className="flex items-start justify-between gap-3">
                        <span><strong className="block text-lg text-slate-950">{plan.name}</strong><small className="text-slate-600">Teste grátis de {trial}</small></span>
                        <span className="shrink-0 text-right"><strong className="block text-xl text-slate-950">{brl(plan.priceCents)}</strong><small className="text-slate-500">por mês</small></span>
                      </span>
                      <span className="mt-3 grid gap-x-4 gap-y-2 border-t border-slate-200/80 pt-3 text-xs text-slate-700 sm:grid-cols-2">
                        {PLAN_FEATURES.filter(([key]) => key !== 'stores' || plan.stores > 0).map(([key, singular, plural]) => (
                          <span key={key} className="flex items-start gap-1.5"><Icon name="check" size={14} />{planLimit(plan, key, singular, plural)}</span>
                        ))}
                        {plan.auditSend && <span className="flex items-start gap-1.5 sm:col-span-2"><Icon name="check" size={14} />Responder conversas pela auditoria</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {error && <div ref={errorRef} className="form-error" role="alert"><p>{error}</p>{!meta && <button type="button" className="link-btn mt-2" onClick={loadPlans}>Tentar carregar os planos novamente</button>}</div>}
            <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900"><strong>{trial} grátis para experimentar.</strong> Seu teste começa quando a conta for criada. Não há cobrança nesta etapa.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setError(''); setStep(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                <Icon name="left" size={17} /> Voltar aos dados
              </button>
              <button className="btn btn-primary" disabled={busy || !meta?.plans.length || !selectedPlan}>
                {busy ? 'Criando sua conta...' : `Criar conta e começar ${trial}`}
              </button>
            </div>
          </>
        )}
      </form>

      <p className="auth-switch">
        Já tem conta? <Link to="/entrar">Entrar</Link>
      </p>
    </AuthShell>
  );
}
