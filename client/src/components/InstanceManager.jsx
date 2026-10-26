import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import BuyMore from './BuyMore.jsx';
import { useAuth } from '../auth.jsx';
import Icon from './Icon.jsx';
import Lamp from './Lamp.jsx';
import Modal from './Modal.jsx';
import { useToast } from './Toast.jsx';
import { useInstances } from '../lib/useInstances.js';
import { formatDoc, plural } from '../lib/format.js';
import { ago } from '../lib/audit.js';

// Conexões de WhatsApp. `purpose`: 'envio' (cobranças e lembretes) ou 'auditoria' (só leitura das conversas).
// Cada conexão pode ser por QR Code (WhatsApp comum) ou pela API oficial da Meta (WhatsApp Cloud API).

function QrModal({ base, instance, initial, onClose, onConnected }) {
  const [qr, setQr] = useState(initial?.qr || null);
  const [pairing, setPairing] = useState(initial?.pairingCode || null);
  const [error, setError] = useState('');
  const qrRef = useRef(initial?.qr || null);
  const doneRef = useRef(onConnected);
  doneRef.current = onConnected;

  useEffect(() => {
    let alive = true;
    let n = 0;
    const tick = async () => {
      n += 1;
      try {
        // Renova o QR a cada ~15s (ele expira) ou assim que estiver disponível.
        if (n % 5 === 0 || !qrRef.current) {
          const r = await api.post(`${base}/${instance.id}/connect`);
          if (!alive) return;
          if (r.connected) return doneRef.current();
          if (r.qr) {
            qrRef.current = r.qr;
            setQr(r.qr);
          }
          setPairing(r.pairingCode);
        } else {
          const list = await api.get(base);
          if (!alive) return;
          if (list.instances.find((i) => i.id === instance.id)?.connected) doneRef.current();
        }
        setError('');
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [instance.id, base]);

  return (
    <Modal title="Conectar WhatsApp" onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Fechar</button>}>
      <div className="qr-wrap">
        <div className="qr-box">{qr ? <img src={qr} alt="QR Code para conectar o WhatsApp" /> : <span className="qr-loading">Gerando QR Code...</span>}</div>
        <ol className="steps">
          <li>Abra o WhatsApp no celular.</li>
          <li>Toque em <strong>Aparelhos conectados</strong>.</li>
          <li>Toque em <strong>Conectar um aparelho</strong> e aponte a câmera para o QR Code.</li>
        </ol>
      </div>
      {pairing && <p className="muted">Prefere código? Digite <strong className="code">{pairing}</strong> em “Conectar com número de telefone”.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="muted small">Esta janela fecha sozinha quando a conexão for concluída.</p>
    </Modal>
  );
}

// Campos da API oficial da Meta. Na edição, deixar o token em branco mantém o que já está salvo.
function MetaModal({ audit, instance, busy, onClose, onSubmit }) {
  const editing = Boolean(instance);
  const [f, setF] = useState({ label: instance?.label || '', phoneNumberId: instance?.metaPhoneNumberId || '', businessId: instance?.metaBusinessId || '', accessToken: '', appSecret: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = (e) => {
    e.preventDefault();
    onSubmit({ label: f.label, meta: { phoneNumberId: f.phoneNumberId, businessId: f.businessId, accessToken: f.accessToken, appSecret: f.appSecret } });
  };
  return (
    <Modal title={editing ? 'Editar API oficial da Meta' : 'Conectar pela API oficial da Meta'} onClose={busy ? () => {} : onClose}
      footer={<><button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn btn-primary" form="meta-form" disabled={busy}>{busy ? 'Conferindo na Meta...' : editing ? 'Salvar' : 'Conectar'}</button></>}>
      <form id="meta-form" onSubmit={submit} className="meta-form" autoComplete="off">
        <label className="field"><span>Nome da conexão <small>(opcional)</small></span><input className="input" value={f.label} onChange={set('label')} maxLength={60} placeholder="Ex.: Atendimento" /></label>
        <label className="field"><span>Phone Number ID</span><input className="input" value={f.phoneNumberId} onChange={set('phoneNumberId')} inputMode="numeric" required placeholder="Ex.: 109876543210987" /></label>
        <label className="field"><span>ID da conta do WhatsApp Business (WABA) <small>(recomendado)</small></span><input className="input" value={f.businessId} onChange={set('businessId')} inputMode="numeric" placeholder="Ex.: 102938475610293" /></label>
        <label className="field"><span>Token de acesso{editing && instance.hasToken ? ' (deixe em branco para manter o atual)' : ''}</span><input className="input" type="password" value={f.accessToken} onChange={set('accessToken')} required={!editing} placeholder={editing ? '••••••••••••' : 'EAAG...'} /></label>
        <label className="field"><span>App Secret {audit ? '' : <small>(opcional)</small>}{editing && instance.hasAppSecret ? ' (em branco mantém o atual)' : ''}</span><input className="input" type="password" value={f.appSecret} onChange={set('appSecret')} required={audit && !editing} placeholder={editing ? '••••••••••••' : ''} /></label>
        <details className="meta-help">
          <summary>Onde encontro esses dados?</summary>
          <ol>
            <li>No painel <strong>developers.facebook.com</strong>, abra seu app e vá em <strong>WhatsApp &gt; Configuração da API</strong>: lá estão o <strong>Phone Number ID</strong> e o <strong>ID da conta do WhatsApp Business</strong>.</li>
            <li>O <strong>token</strong> deve ser permanente (crie um usuário do sistema em Configurações do Negócio e gere o token com a permissão <em>whatsapp_business_messaging</em>).</li>
            <li>O <strong>App Secret</strong> fica em <strong>Configurações do app &gt; Básico</strong>. {audit ? 'Ele é obrigatório na auditoria: protege o recebimento das mensagens.' : 'Só é necessário se você também for receber mensagens.'}</li>
            <li>O token e o App Secret ficam guardados criptografados e nunca aparecem de novo.</li>
          </ol>
        </details>
        {audit && <p className="muted small">Pela API oficial a auditoria vê as mensagens do número a partir de agora (a Meta não entrega o histórico antigo).</p>}
      </form>
    </Modal>
  );
}

function CopyRow({ label, value }) {
  const toast = useToast();
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); toast('Copiado.'); } catch { toast('Não foi possível copiar. Selecione e copie manualmente.', 'error'); }
  };
  return (
    <div className="field">
      <span>{label}</span>
      <div className="copy-row"><input className="input" readOnly value={value} onFocus={(e) => e.target.select()} /><button type="button" className="btn btn-ghost btn-sm" onClick={copy}>Copiar</button></div>
    </div>
  );
}

function WebhookModal({ instance, url, publicUrl, onClose }) {
  return (
    <Modal title="Receber mensagens da Meta (webhook)" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Entendi</button>}>
      <p>No painel da Meta, vá em <strong>WhatsApp &gt; Configuração</strong> &gt; <strong>Webhook</strong>, clique em <strong>Editar</strong> e cole:</p>
      <CopyRow label="URL de retorno de chamada" value={url} />
      <CopyRow label="Token de verificação" value={instance.metaVerifyToken} />
      <p>Depois de verificar, assine o campo <strong>messages</strong>.</p>
      {!publicUrl && <p className="form-error">O endereço do sistema (APP_URL) ainda é local. A Meta só consegue chamar o sistema quando ele está publicado na internet com https.</p>}
    </Modal>
  );
}

export default function InstanceManager({ purpose = 'envio' }) {
  const audit = purpose === 'auditoria';
  const base = audit ? '/audit/instances' : '/instances';
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useInstances(5000, base);
  const [busy, setBusy] = useState('');
  const [qrFor, setQrFor] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [choose, setChoose] = useState(false);
  const [metaFor, setMetaFor] = useState(null); // { instance? }
  const [hookFor, setHookFor] = useState(null);

  const instances = data?.instances || [];
  const limit = data?.limit ?? user.limits[audit ? 'auditInstances' : 'instances'];
  const canAdd = instances.length < limit;
  const noun = audit ? ['número para auditoria', 'números para auditoria'] : ['WhatsApp conectado', 'WhatsApps conectados'];

  async function run(key, fn, okMsg) {
    setBusy(key);
    try {
      const r = await fn();
      if (okMsg) toast(okMsg);
      return r;
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
      reload();
    }
  }

  async function addQr() {
    setChoose(false);
    const r = await run('add', () => api.post(base, { provider: 'evolution' }));
    if (r) setQrFor({ instance: r.instance, initial: r });
  }

  async function saveMeta(values) {
    const editing = metaFor?.instance;
    setBusy('meta');
    try {
      const r = editing ? await api.patch(`${base}/${editing.id}`, values) : await api.post(base, { provider: 'meta', ...values });
      setMetaFor(null);
      toast(editing ? 'Dados da API oficial atualizados.' : 'API oficial conectada!');
      if (!editing && audit) setHookFor(r.instance);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
      reload();
    }
  }

  async function connect(inst) {
    const r = await run(`c${inst.id}`, () => api.post(`${base}/${inst.id}/connect`), inst.provider === 'meta' ? 'Conexão com a Meta funcionando.' : undefined);
    if (!r || inst.provider === 'meta') return;
    if (r.connected) toast('Este WhatsApp já está conectado.');
    else setQrFor({ instance: inst, initial: r });
  }

  async function sync(inst) {
    const r = await run(`s${inst.id}`, () => api.post(`${base}/${inst.id}/sync`));
    if (r) toast(r.started ? 'Importação iniciada. O progresso aparece na tela e as conversas entram sozinhas.' : 'Já está importando.');
  }

  const remove = async (inst) => {
    setConfirmDel(null);
    await run(`d${inst.id}`, () => api.del(`${base}/${inst.id}`), audit ? 'Número removido.' : 'WhatsApp removido.');
  };

  const title = (i) => i.label || (i.provider === 'meta' ? i.metaPhoneDisplay || `ID ${i.metaPhoneNumberId}` : formatDoc(i.name));
  const status = (i) => (i.connected ? 'Conectado' : i.state === 'unknown' ? 'Sem resposta do servidor' : i.provider === 'meta' ? 'Token recusado pela Meta' : i.state === 'connecting' ? 'Aguardando leitura do QR Code' : 'Desconectado');

  return (
    <>
      {data && !data.evolutionConfigured && (
        <div className="banner banner-red"><div><strong>Integração não configurada</strong><span>Para conectar por QR Code o administrador precisa preencher a Evolution API no arquivo .env. A API oficial da Meta funciona sem ela.</span></div></div>
      )}
      {data?.unreachable && (
        <div className="banner banner-red"><div><strong>Não foi possível verificar a conexão</strong><span>O servidor do WhatsApp não respondeu. Tentaremos de novo automaticamente.</span></div></div>
      )}
      {error && <div className="banner banner-red"><div><strong>{error}</strong></div></div>}

      {data && instances.length === 0 && (
        <section className="empty-hero">
          <Lamp on={false} size="xl" />
          <h2>{audit ? 'Conecte um número para auditar' : 'Conecte seu primeiro WhatsApp'}</h2>
          <p>
            {audit
              ? 'Escolha como conectar: QR Code (WhatsApp comum) ou API oficial da Meta. As conversas passam a aparecer aqui em tempo real, só para leitura.'
              : <>Escolha como conectar: <strong>QR Code</strong> (leia com o celular que enviará as mensagens) ou <strong>API oficial da Meta</strong>.</>}
          </p>
          <button className="btn btn-primary" onClick={() => setChoose(true)} disabled={busy === 'add'}>{busy === 'add' ? 'Criando conexão...' : audit ? 'Conectar número' : 'Conectar WhatsApp'}</button>
        </section>
      )}

      {instances.length > 0 && (
        <ul className="instance-list">
          {instances.map((i) => (
            <li key={i.id} className={`instance ${i.connected ? 'is-on' : ''}`}>
              <Lamp on={i.connected} pending={i.state === 'unknown' && (i.provider === 'meta' || data?.evolutionConfigured)} size="lg" />
              <div className="instance-info">
                <strong>{title(i)} <span className={`prov-badge prov-${i.provider}`}>{i.provider === 'meta' ? 'API oficial' : 'QR Code'}</span></strong>
                <span>
                  {status(i)}
                  {i.provider === 'meta' && i.metaPhoneDisplay && i.label ? ` · ${i.metaPhoneDisplay}` : ''}
                  {i.provider !== 'meta' && i.label ? ` · ${formatDoc(i.name)}` : ''}
                </span>
                {audit && i.connected && i.provider === 'evolution' && (
                  <span className="inst-health">
                    {i.sync?.running
                      ? `Importando conversas: ${i.sync.done} de ${i.sync.total || '...'} (${plural(i.sync.imported, 'mensagem', 'mensagens')})`
                      : `Atualização automática ligada${i.lastSyncAt ? ` · última busca ${ago(i.lastSyncAt)}` : ' · primeira busca em instantes'}`}
                    {' · '}
                    {i.lastEventAt ? `tempo real recebendo (último evento ${ago(i.lastEventAt)})` : data?.appUrlIsPublic ? 'tempo real: nenhum evento ainda (a busca automática cobre)' : 'tempo real indisponível (o sistema precisa estar publicado); a busca automática cobre'}
                  </span>
                )}
              </div>
              <div className="instance-actions">
                {i.provider === 'meta' ? (
                  <>
                    <button className="btn btn-ghost btn-sm" onClick={() => connect(i)} disabled={busy === `c${i.id}`}>{busy === `c${i.id}` ? 'Testando...' : 'Testar conexão'}</button>
                    {audit && <button className="btn btn-ghost btn-sm" onClick={() => setHookFor(i)}>Webhook</button>}
                    <button className="btn btn-ghost btn-sm" onClick={() => setMetaFor({ instance: i })}><Icon name="edit" size={16} /> Editar</button>
                  </>
                ) : (
                  <>
                    {!i.connected && <button className="btn btn-primary btn-sm" onClick={() => connect(i)} disabled={busy === `c${i.id}`}>{busy === `c${i.id}` ? 'Gerando...' : 'Ler QR Code'}</button>}
                    {i.connected && audit && <button className="btn btn-ghost btn-sm" onClick={() => sync(i)} disabled={busy === `s${i.id}`}>{busy === `s${i.id}` ? 'Iniciando...' : 'Importar tudo agora'}</button>}
                    {i.connected && (
                      <button className="btn btn-ghost btn-sm" onClick={() => run(`l${i.id}`, () => api.post(`${base}/${i.id}/logout`), 'WhatsApp desconectado.')} disabled={busy === `l${i.id}`}>
                        <Icon name="unplug" size={16} /> Desconectar
                      </button>
                    )}
                  </>
                )}
                <button className="icon-btn icon-btn-danger" onClick={() => setConfirmDel(i)} aria-label={`Remover ${title(i)}`} title="Remover"><Icon name="trash" size={18} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {instances.length > 0 && (
        <div className="add-row">
          {canAdd ? (
            <button className="btn btn-ghost" onClick={() => setChoose(true)} disabled={busy === 'add'}><Icon name="plus" size={18} /> {audit ? 'Adicionar outro número' : 'Adicionar outro WhatsApp'}</button>
          ) : (
            <p className="muted small">Você usou {instances.length} de {limit}. Para conectar mais, adquira limite extra ou mude para um plano maior.</p>
          )}
          <BuyMore resource={audit ? 'auditInstances' : 'instances'} />
        </div>
      )}
      {data && <p className="muted small">Seu plano permite {plural(limit, noun[0], noun[1])}.</p>}

      {choose && (
        <Modal title="Como você quer conectar?" onClose={() => setChoose(false)} footer={<button className="btn btn-ghost" onClick={() => setChoose(false)}>Cancelar</button>}>
          <div className="conn-choice">
            <button type="button" className="conn-opt" onClick={addQr} disabled={data?.evolutionConfigured === false}>
              <strong>QR Code</strong>
              <span>Leia o QR Code com o WhatsApp do celular, como no WhatsApp Web. Rápido e sem cadastro na Meta.</span>
            </button>
            <button type="button" className="conn-opt" onClick={() => { setChoose(false); setMetaFor({}); }}>
              <strong>API oficial da Meta</strong>
              <span>WhatsApp Cloud API: número oficial do WhatsApp Business, com Phone Number ID e token da Meta.</span>
            </button>
          </div>
        </Modal>
      )}

      {metaFor && <MetaModal audit={audit} instance={metaFor.instance} busy={busy === 'meta'} onClose={() => setMetaFor(null)} onSubmit={saveMeta} />}
      {hookFor && <WebhookModal instance={hookFor} url={data?.metaWebhookUrl || ''} publicUrl={data?.appUrlIsPublic} onClose={() => setHookFor(null)} />}

      {qrFor && (
        <QrModal base={base} instance={qrFor.instance} initial={qrFor.initial}
          onClose={() => { setQrFor(null); reload(); }}
          onConnected={() => { setQrFor(null); toast('WhatsApp conectado!'); reload(); }} />
      )}

      {confirmDel && (
        <Modal title={audit ? 'Remover este número?' : 'Remover este WhatsApp?'} onClose={() => setConfirmDel(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>Cancelar</button><button className="btn btn-danger" onClick={() => remove(confirmDel)}>Remover</button></>}>
          <p>
            A conexão <strong>{title(confirmDel)}</strong> será apagada.
            {audit ? ' As conversas, etiquetas e anotações deste número também serão apagadas.' : confirmDel.provider === 'meta' ? ' Para voltar a usar, será preciso cadastrar o token de novo.' : ' Para voltar a enviar, será preciso ler o QR Code de novo.'}
          </p>
        </Modal>
      )}
    </>
  );
}
