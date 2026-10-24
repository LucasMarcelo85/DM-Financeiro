import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import PlanBadge from '../components/PlanBadge.jsx';
import { ForgotPinModal, onlyPinDigits } from '../components/PinPrompt.jsx';
import { useToast } from '../components/Toast.jsx';
import { dateBR, formatDoc, formatStoredPhone, maskPhone } from '../lib/format.js';
import { PIN_TABS, tabLabel } from '../lib/pin.js';

export default function Profile() {
  const { user } = useAuth();
  const [configuring, setConfiguring] = useState(false);
  const isAdmin = user.role === 'admin';

  if (configuring) return <Settings onBack={() => setConfiguring(false)} />;

  return (
    <>
      <header className="page-head">
        <h1>Perfil</h1>
        <p className="muted">Seus dados de acesso e as proteções da sua conta.</p>
      </header>

      <section className="card profile-card">
        <div className="profile-top">
          <span className="profile-avatar" aria-hidden="true">{user.name.trim().charAt(0).toUpperCase()}</span>
          <div className="profile-name">
            <strong>{user.name}</strong>
            {isAdmin ? <span className="badge plan-admin">Admin</span> : <PlanBadge plan={user.plan} name={user.planName} color={user.planColor} />}
          </div>
          <button className="btn btn-primary" onClick={() => setConfiguring(true)}>
            <Icon name="gear" size={18} /> Configurar
          </button>
        </div>
        <dl className="profile-data">
          <div><dt>{user.kind === 'PJ' ? 'CNPJ' : 'CPF'}</dt><dd>{user.document === 'admin' ? '-' : formatDoc(user.document)}</dd></div>
          <div><dt>E-mail</dt><dd>{user.email}</dd></div>
          <div><dt>WhatsApp</dt><dd>{user.phone ? formatStoredPhone(user.phone) : 'Não cadastrado'}</dd></div>
          {!isAdmin && <div><dt>Acesso até</dt><dd>{dateBR(user.access.endsAt)}</dd></div>}
          <div><dt>Código PIN</dt><dd>{user.pin?.enabled ? `Ativo em ${user.pin.tabs.length} ${user.pin.tabs.length === 1 ? 'aba' : 'abas'}` : 'Desativado'}</dd></div>
        </dl>
        {!user.phone && <p className="banner banner-amber profile-warn">Cadastre seu WhatsApp em <strong>Configurar</strong> para poder recuperar a senha e o código PIN.</p>}
      </section>
    </>
  );
}

function Settings({ onBack }) {
  const { user, setUser } = useAuth();
  const toast = useToast();

  // ---- dados da conta
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone ? maskPhone(user.phone) : '');
  const [dataPassword, setDataPassword] = useState('');
  const [dataError, setDataError] = useState('');
  const [dataBusy, setDataBusy] = useState(false);
  const sensitiveChanged = email.trim().toLowerCase() !== user.email || phone.replace(/\D/g, '') !== (user.phone || '');

  async function saveData(e) {
    e.preventDefault();
    setDataError('');
    setDataBusy(true);
    try {
      const r = await api.patch('/auth/profile', { name, email, phone, ...(sensitiveChanged ? { currentPassword: dataPassword } : {}) });
      setUser(r.user);
      setDataPassword('');
      toast('Dados atualizados.');
    } catch (err) {
      setDataError(err.message);
    } finally {
      setDataBusy(false);
    }
  }

  // ---- senha
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  async function savePassword(e) {
    e.preventDefault();
    setPwError('');
    if (newPw !== newPw2) return setPwError('A confirmação da nova senha não confere.');
    setPwBusy(true);
    try {
      const r = await api.patch('/auth/profile', { newPassword: newPw, currentPassword: curPw });
      setUser(r.user);
      setCurPw(''); setNewPw(''); setNewPw2('');
      toast('Senha alterada.');
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <>
      <header className="page-head">
        <button className="link-btn back-link" onClick={onBack}><Icon name="left" size={16} /> Voltar ao perfil</button>
        <h1>Configurar</h1>
        <p className="muted">Altere seus dados, a senha e crie um código PIN para proteger abas do sistema.</p>
      </header>

      <form className="card form settings-card" onSubmit={saveData} noValidate>
        <h2 className="card-title">Dados da conta</h2>
        <label className="field"><span>{user.kind === 'PJ' ? 'Razão social' : 'Nome'}</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>E-mail</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
        <label className="field">
          <span>WhatsApp (para receber códigos de recuperação)</span>
          <input className="input" inputMode="tel" placeholder="(85) 99999-9999" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} autoComplete="tel" />
        </label>
        {sensitiveChanged && (
          <label className="field">
            <span>Senha atual (necessária para trocar e-mail ou WhatsApp)</span>
            <input className="input" type="password" value={dataPassword} onChange={(e) => setDataPassword(e.target.value)} autoComplete="current-password" />
          </label>
        )}
        {dataError && <p className="form-error" role="alert">{dataError}</p>}
        <div><button className="btn btn-primary" disabled={dataBusy || (sensitiveChanged && !dataPassword)}>{dataBusy ? 'Salvando...' : 'Salvar dados'}</button></div>
      </form>

      <form className="card form settings-card" onSubmit={savePassword} noValidate>
        <h2 className="card-title">Alterar senha</h2>
        <label className="field"><span>Senha atual</span><input className="input" type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" /></label>
        <label className="field"><span>Nova senha (mínimo 8 caracteres)</span><input className="input" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" /></label>
        <label className="field"><span>Repita a nova senha</span><input className="input" type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} autoComplete="new-password" /></label>
        {pwError && <p className="form-error" role="alert">{pwError}</p>}
        <div><button className="btn btn-primary" disabled={pwBusy || !curPw || newPw.length < 8 || !newPw2}>{pwBusy ? 'Salvando...' : 'Alterar senha'}</button></div>
      </form>

      <PinSection />
    </>
  );
}

// ---------- Código PIN ----------
function PinSection() {
  const { user, pinUnlocked, applyPin, lockPin } = useAuth();
  const toast = useToast();
  const enabled = Boolean(user.pin?.enabled);
  const [mode, setMode] = useState(null); // 'create' | 'edit'
  const [removing, setRemoving] = useState(false);
  const [forgot, setForgot] = useState(false);

  return (
    <section className="card settings-card">
      <h2 className="card-title">Código PIN</h2>
      {!enabled && mode !== 'create' && (
        <>
          <p className="muted">Crie um código PIN e escolha quais abas ficam protegidas. Quem não souber o código não consegue abrir essas abas.</p>
          <div><button className="btn btn-primary" onClick={() => setMode('create')}><Icon name="lock" size={18} /> Criar código PIN</button></div>
        </>
      )}
      {mode ? (
        <PinForm key={mode} mode={mode} onDone={(r, msg) => { applyPin(r); setMode(null); toast(msg); }} onCancel={() => setMode(null)} />
      ) : enabled && (
        <>
          <p>O PIN está <strong>ativo</strong>. Abas protegidas:</p>
          <ul className="pin-tags">{user.pin.tabs.map((t) => <li key={t}>{tabLabel(t)}</li>)}</ul>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => setMode('edit')}>Alterar PIN ou abas</button>
            {pinUnlocked && <button className="btn btn-ghost" onClick={async () => { await lockPin(); toast('Abas protegidas travadas.'); }}>Bloquear agora</button>}
            <button className="btn btn-ghost" onClick={() => setRemoving(true)}>Remover PIN</button>
          </div>
          <button className="link-btn" onClick={() => setForgot(true)}>Esqueci o código PIN</button>
        </>
      )}
      {removing && <RemovePinModal onClose={() => setRemoving(false)} onDone={(r) => { applyPin(r); setRemoving(false); toast('Código PIN removido.'); }} />}
      {forgot && <ForgotPinModal onClose={() => setForgot(false)} />}
    </section>
  );
}

function PinForm({ mode, onDone, onCancel }) {
  const { user } = useAuth();
  const editing = mode === 'edit';
  const options = PIN_TABS.filter((t) => !t.adminOnly || user.role === 'admin');
  const [currentPin, setCurrentPin] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [tabs, setTabs] = useState(editing ? user.pin.tabs : []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (key) => setTabs((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (pin && pin !== pin2) return setError('A confirmação do PIN não confere.');
    if (!editing && pin.length < 4) return setError('O PIN deve ter de 4 a 8 números.');
    if (!tabs.length) return setError('Escolha pelo menos uma aba para proteger.');
    setBusy(true);
    try {
      const r = await api.put('/auth/pin', { tabs, ...(pin ? { pin } : {}), ...(editing ? { currentPin } : {}) });
      onDone(r, editing ? 'Código PIN atualizado.' : 'Código PIN criado.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {editing && (
        <label className="field">
          <span>PIN atual</span>
          <input className="input pin-input" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={currentPin} onChange={(e) => setCurrentPin(onlyPinDigits(e.target.value))} />
        </label>
      )}
      <div className="grid-2">
        <label className="field">
          <span>{editing ? 'Novo PIN (deixe em branco para manter)' : 'Código PIN (4 a 8 números)'}</span>
          <input className="input pin-input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin} onChange={(e) => setPin(onlyPinDigits(e.target.value))} />
        </label>
        <label className="field">
          <span>Repita o PIN</span>
          <input className="input pin-input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin2} onChange={(e) => setPin2(onlyPinDigits(e.target.value))} disabled={!pin} />
        </label>
      </div>
      <fieldset className="field">
        <legend>Quais abas serão protegidas pelo PIN?</legend>
        <div className="pin-tabs">
          {options.map((t) => (
            <label key={t.key} className={`pin-tab ${tabs.includes(t.key) ? 'is-on' : ''}`}>
              <input type="checkbox" checked={tabs.includes(t.key)} onChange={() => toggle(t.key)} />
              {t.label}
            </label>
          ))}
        </div>
        <small>Só quem digitar o PIN consegue abrir as abas marcadas.</small>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="btn-row">
        <button className="btn btn-primary" disabled={busy || (editing && currentPin.length < 4)}>{busy ? 'Salvando...' : editing ? 'Salvar alterações' : 'Criar código PIN'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

function RemovePinModal({ onClose, onDone }) {
  const [currentPin, setCurrentPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function remove() {
    setError('');
    setBusy(true);
    try {
      onDone(await api.post('/auth/pin/disable', { currentPin }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Remover o código PIN?" onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-danger" disabled={busy || currentPin.length < 4} onClick={remove}>Remover PIN</button></>}>
      <p>As abas deixam de ser protegidas. Digite o PIN atual para confirmar.</p>
      <label className="field">
        <span>PIN atual</span>
        <input className="input pin-input" type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={8} value={currentPin} onChange={(e) => setCurrentPin(onlyPinDigits(e.target.value))} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  );
}
