import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import Lamp from '../components/Lamp.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { useInstances } from '../lib/useInstances.js';
import { formatDoc, plural } from '../lib/format.js';

function QrModal({ instance, initial, onClose, onConnected }) {
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
          const r = await api.post(`/instances/${instance.id}/connect`);
          if (!alive) return;
          if (r.connected) return doneRef.current();
          if (r.qr) {
            qrRef.current = r.qr;
            setQr(r.qr);
          }
          setPairing(r.pairingCode);
        } else {
          const list = await api.get('/instances');
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
  }, [instance.id]);

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

export default function WhatsApp() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useInstances(5000);
  const [busy, setBusy] = useState('');
  const [qrFor, setQrFor] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const instances = data?.instances || [];
  const limit = data?.limit ?? user.limits.instances;
  const canAdd = instances.length < limit;

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

  async function add() {
    const r = await run('add', () => api.post('/instances'));
    if (r) setQrFor({ instance: r.instance, initial: r });
  }

  async function connect(inst) {
    const r = await run(`c${inst.id}`, () => api.post(`/instances/${inst.id}/connect`));
    if (!r) return;
    if (r.connected) toast('Este WhatsApp já está conectado.');
    else setQrFor({ instance: inst, initial: r });
  }

  async function remove(inst) {
    setConfirmDel(null);
    await run(`d${inst.id}`, () => api.del(`/instances/${inst.id}`), 'WhatsApp removido.');
  }

  return (
    <>
      <header className="page-head">
        <h1>WhatsApp</h1>
        <p className="muted">
          Seu plano permite {plural(limit, 'WhatsApp conectado', 'WhatsApps conectados')}. O nome de cada conexão é o seu CPF/CNPJ.
        </p>
      </header>

      {data && !data.evolutionConfigured && (
        <div className="banner banner-red"><div><strong>Integração não configurada</strong><span>O administrador precisa preencher a Evolution API no arquivo .env.</span></div></div>
      )}
      {data?.unreachable && (
        <div className="banner banner-red"><div><strong>Não foi possível verificar a conexão</strong><span>O servidor do WhatsApp não respondeu. Tentaremos de novo automaticamente.</span></div></div>
      )}
      {error && <div className="banner banner-red"><div><strong>{error}</strong></div></div>}

      {data && instances.length === 0 && (
        <section className="empty-hero">
          <Lamp on={false} size="xl" />
          <h2>Conecte seu primeiro WhatsApp</h2>
          <p>Vamos criar a conexão <strong>{formatDoc(user.document)}</strong> e mostrar um QR Code. Leia com o celular que enviará as mensagens.</p>
          <button className="btn btn-primary" onClick={add} disabled={busy === 'add' || data.evolutionConfigured === false}>
            {busy === 'add' ? 'Criando conexão...' : 'Conectar WhatsApp'}
          </button>
        </section>
      )}

      {instances.length > 0 && (
        <ul className="instance-list">
          {instances.map((i) => (
            <li key={i.id} className={`instance ${i.connected ? 'is-on' : ''}`}>
              <Lamp on={i.connected} pending={i.state === 'unknown' && data?.evolutionConfigured} size="lg" />
              <div className="instance-info">
                <strong>{formatDoc(i.name)}</strong>
                <span>{i.connected ? 'Conectado' : i.state === 'unknown' ? 'Sem resposta do servidor' : i.state === 'connecting' ? 'Aguardando leitura do QR Code' : 'Desconectado'}</span>
              </div>
              <div className="instance-actions">
                {!i.connected && (
                  <button className="btn btn-primary btn-sm" onClick={() => connect(i)} disabled={busy === `c${i.id}`}>
                    {busy === `c${i.id}` ? 'Gerando...' : 'Ler QR Code'}
                  </button>
                )}
                {i.connected && (
                  <button className="btn btn-ghost btn-sm" onClick={() => run(`l${i.id}`, () => api.post(`/instances/${i.id}/logout`), 'WhatsApp desconectado.')} disabled={busy === `l${i.id}`}>
                    <Icon name="unplug" size={16} /> Desconectar
                  </button>
                )}
                <button className="icon-btn icon-btn-danger" onClick={() => setConfirmDel(i)} aria-label={`Remover ${i.name}`} title="Remover">
                  <Icon name="trash" size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {instances.length > 0 && (
        <div className="add-row">
          {canAdd ? (
            <button className="btn btn-ghost" onClick={add} disabled={busy === 'add'}>
              <Icon name="plus" size={18} /> Adicionar outro WhatsApp
            </button>
          ) : (
            <p className="muted small">Você usou {instances.length} de {limit}. Para conectar mais, mude para um plano maior.</p>
          )}
        </div>
      )}

      {qrFor && (
        <QrModal
          instance={qrFor.instance}
          initial={qrFor.initial}
          onClose={() => { setQrFor(null); reload(); }}
          onConnected={() => { setQrFor(null); toast('WhatsApp conectado!'); reload(); }}
        />
      )}

      {confirmDel && (
        <Modal
          title="Remover este WhatsApp?"
          onClose={() => setConfirmDel(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>Cancelar</button>
              <button className="btn btn-danger" onClick={() => remove(confirmDel)}>Remover</button>
            </>
          }
        >
          <p>A conexão <strong>{formatDoc(confirmDel.name)}</strong> será apagada. Para voltar a enviar, será preciso ler o QR Code de novo.</p>
        </Modal>
      )}
    </>
  );
}
