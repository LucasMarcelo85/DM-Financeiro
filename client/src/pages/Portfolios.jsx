import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import ShareModal from '../components/portfolio/ShareModal.jsx';
import { useToast } from '../components/Toast.jsx';
import { dateBR, plural } from '../lib/format.js';
import { pageUrl } from '../lib/portfolio/model.js';
import { copyText } from '../lib/portfolio/share.js';
import { TEMPLATES, buildTemplate } from '../lib/portfolio/templates.js';

function NewPageModal({ onClose, onCreate, busy }) {
  const [key, setKey] = useState('services');
  const [name, setName] = useState('');
  return (
    <Modal title="Nova página de portfólio" onClose={busy ? () => {} : onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn btn-primary" onClick={() => onCreate(key, name)} disabled={busy}>{busy ? 'Criando...' : 'Criar e editar'}</button></>}>
      <label className="field"><span>Nome da página</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ex.: Apresentação da empresa" autoFocus /></label>
      <fieldset className="field">
        <legend>Começar de</legend>
        <div className="ct-templates">
          {TEMPLATES.map((t) => (
            <label key={t.key} className={`ct-template ${key === t.key ? 'is-on' : ''}`}>
              <input type="radio" name="ptpl" value={t.key} checked={key === t.key} onChange={() => setKey(t.key)} />
              <strong>{t.label}</strong>
              <span className="muted small">{t.desc}</span>
            </label>
          ))}
        </div>
        <small>Tudo pode ser trocado no editor: cores, banner, logo, imagens, vídeo, textos e botões.</small>
      </fieldset>
    </Modal>
  );
}

// Domínio próprio: o usuário aponta o domínio dele (registro A) para o IP do servidor e o site passa a abrir em meusite.com.br.
function DomainCard({ domain, onChange }) {
  const toast = useToast();
  const [value, setValue] = useState(domain.name);
  const [busy, setBusy] = useState('');
  useEffect(() => setValue(domain.name), [domain.name]);

  const saved = Boolean(domain.name);
  const changed = value.trim() !== domain.name;

  async function run(kind, fn, okMsg) {
    setBusy(kind);
    try {
      const r = await fn();
      if (okMsg) toast(okMsg(r));
      await onChange();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  }

  const save = () => run('save', () => api.put('/portfolios/domain', { domain: value }),
    (r) => (r.domain.verified ? 'Domínio ativo! Seu site já abre nele.' : 'Domínio salvo. Falta apontar o DNS (veja abaixo).'));
  const remove = () => run('remove', () => api.put('/portfolios/domain', { domain: '' }), () => 'Domínio removido.');
  const check = () => run('check', () => api.post('/portfolios/domain/check'),
    (r) => (r.domain.verified ? 'Domínio ativo! Seu site já abre nele.' : 'Ainda não encontrei o apontamento. O DNS pode levar de minutos a algumas horas.'));

  return (
    <section className="pl-domain">
      <div className="pl-domain-head">
        <span className="action-icon"><Icon name="link" size={22} /></span>
        <div>
          <strong>Domínio próprio</strong>
          <span className="muted small">Use o endereço do seu site (ex.: <code>meusite.com.br</code>) em vez do endereço do sistema. A página principal abre direto nele e as outras ficam depois da barra.</span>
        </div>
        {saved && <span className={`pill ${domain.verified ? 'pill-sent' : 'pill-partial'}`}>{domain.verified ? 'Ativo' : 'Aguardando DNS'}</span>}
      </div>

      <div className="pl-domain-row">
        <input className="input" value={value} onChange={(e) => setValue(e.target.value)} maxLength={253} placeholder="meusite.com.br" aria-label="Seu domínio" inputMode="url" autoCapitalize="none" spellCheck={false} />
        <button className="btn btn-primary" onClick={save} disabled={!!busy || !value.trim() || !changed}>{busy === 'save' ? 'Salvando...' : 'Salvar domínio'}</button>
        {saved && <button className="btn btn-ghost" onClick={remove} disabled={!!busy}>{busy === 'remove' ? 'Removendo...' : 'Remover'}</button>}
      </div>

      {saved && !domain.verified && (
        <div className="banner banner-amber">
          <div>
            <strong>Falta apontar o domínio para o sistema.</strong>
            <span>
              No painel onde você registrou o domínio (Registro.br, GoDaddy, Hostinger...), abra o <b>DNS</b> e crie um registro
              {' '}<b>tipo A</b>, nome <b>@</b>{domain.serverIp ? <>, apontando para <code>{domain.serverIp}</code></> : ' (o IP do servidor)'}. Se quiser o <b>www</b>, crie outro igual com nome <b>www</b>.
              No Cloudflare, deixe a nuvem <b>cinza</b> (somente DNS).
            </span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={check} disabled={!!busy}>{busy === 'check' ? 'Verificando...' : 'Verificar agora'}</button>
        </div>
      )}
      {!saved && domain.serverIp && <p className="muted small">Depois de salvar, aponte o DNS do seu domínio (registro <b>tipo A</b>) para o IP <code>{domain.serverIp}</code>.</p>}
      {saved && domain.verified && <p className="muted small">Seu site abre em <strong>{domain.name}</strong>. O endereço antigo do sistema continua funcionando.</p>}
    </section>
  );
}

export default function Portfolios() {
  const toast = useToast();
  const nav = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(() => api.get('/portfolios').then((r) => alive.current && setData(r)).catch((e) => toast(e.message, 'error')), [toast]);
  useEffect(() => { load(); }, [load]);

  const count = data?.portfolios.length ?? 0;
  const full = data && count >= data.limit;

  async function create(key, name) {
    setBusy('create');
    try {
      const tpl = TEMPLATES.find((t) => t.key === key);
      const { portfolio } = await api.post('/portfolios', { name: name.trim() || tpl.label, data: buildTemplate(key, user.name) });
      nav(`/portfolio/${portfolio.id}`);
    } catch (e) { toast(e.message, 'error'); setBusy(''); }
  }

  async function copy(p) {
    if (await copyText(pageUrl(p.path, p.customUrl))) toast('Link copiado!'); else setSharing(p);
  }

  async function duplicate(p) {
    try { await api.post(`/portfolios/${p.id}/duplicate`); toast('Página duplicada.'); load(); } catch (e) { toast(e.message, 'error'); }
  }

  async function makeMain(p) {
    try { await api.post(`/portfolios/${p.id}/main`); toast('Agora é a página principal.'); load(); } catch (e) { toast(e.message, 'error'); }
  }

  async function publish(p) {
    setPublishing(true);
    try {
      await api.patch(`/portfolios/${p.id}`, { published: true });
      toast('Página publicada. O link já funciona.');
      setSharing({ ...p, published: true });
      load();
    } catch (e) { toast(e.message, 'error'); } finally { setPublishing(false); }
  }

  async function remove(p) {
    setConfirmDel(null);
    try { await api.del(`/portfolios/${p.id}`); toast('Página excluída.'); load(); } catch (e) { toast(e.message, 'error'); }
  }

  const base = data ? pageUrl(`/${data.userSlug}`).replace(/^https?:\/\//, '') : '';

  return (
    <>
      <header className="page-head head-row">
        <div>
          <h1>Portfólio</h1>
          <p className="muted">
            Crie páginas profissionais com a sua marca e envie o link para clientes.
            {data ? ` Você usou ${count} de ${plural(data.limit, 'página', 'páginas')} do seu plano.` : ''}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setNewOpen(true)} disabled={!data || full || !!busy}><Icon name="plus" size={18} /> Nova página</button>
      </header>

      {full && (
        <div className="banner banner-amber">
          <div><strong>Você usou todas as páginas do seu plano.</strong><span>Exclua uma página ou mude de plano para criar mais.</span></div>
          <Link className="btn btn-ghost btn-sm" to="/plano">Ver planos</Link>
        </div>
      )}

      {data && (
        <div className="pl-addr">
          <span className="action-icon"><Icon name="globe" size={22} /></span>
          <div>
            <strong>Seu endereço</strong>
            <code>{base}</code>
            <span className="muted small">Vem do seu nome ou razão social e fica o mesmo para sempre. A página principal abre aqui; as outras ficam depois da barra.</span>
          </div>
        </div>
      )}

      {data && <DomainCard domain={data.domain} onChange={load} />}

      {data === null ? <p className="muted">Carregando...</p> : count === 0 ? (
        <section className="empty-hero">
          <span className="action-icon action-icon-lg"><Icon name="globe" size={32} /></span>
          <h2>Crie sua primeira página</h2>
          <p>Escolha cores, banner, logo, imagens, vídeo, textos e botões com link. No fim, copie o link e envie para quem quiser.</p>
          <button className="btn btn-primary" onClick={() => setNewOpen(true)}>Nova página</button>
        </section>
      ) : (
        <ul className="ct-grid">
          {data.portfolios.map((p) => (
            <li key={p.id} className="ct-card">
              <Link to={`/portfolio/${p.id}`} className="ct-main">
                <span className="action-icon"><Icon name="globe" size={22} /></span>
                <strong title={p.name}>{p.name}</strong>
                <span className="pl-badges">
                  <span className={`pill ${p.published ? 'pill-sent' : 'pill-partial'}`}>{p.published ? 'Publicada' : 'Rascunho'}</span>
                  {p.isMain && <span className="tag tag-monthly">Principal</span>}
                </span>
                <span className="pl-url" title={pageUrl(p.path, p.customUrl)}><Icon name="link" size={14} /><span>{pageUrl(p.path, p.customUrl).replace(/^https?:\/\//, '')}</span></span>
                <span className="muted small">editada em {dateBR(p.updatedAt)}</span>
              </Link>
              <div className="ct-actions">
                <Link className="btn btn-primary btn-sm" to={`/portfolio/${p.id}`}><Icon name="edit" size={16} /> Editar</Link>
                <button className="btn btn-ghost btn-sm" onClick={() => copy(p)}><Icon name="copy" size={16} /> Copiar link</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSharing(p)}><Icon name="share" size={16} /> Compartilhar</button>
                <button className="icon-btn icon-btn-danger" onClick={() => setConfirmDel(p)} aria-label={`Excluir ${p.name}`} title="Excluir"><Icon name="trash" size={18} /></button>
              </div>
              <div className="pl-more">
                {p.published && <a className="link-btn" href={pageUrl(p.path, p.customUrl)} target="_blank" rel="noopener noreferrer">Abrir página</a>}
                <button className="link-btn" onClick={() => duplicate(p)} disabled={full}>Duplicar</button>
                {!p.isMain && <button className="link-btn" onClick={() => makeMain(p)}>Tornar principal</button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {newOpen && <NewPageModal busy={busy === 'create'} onClose={() => setNewOpen(false)} onCreate={create} />}
      {sharing && <ShareModal name={sharing.name} path={sharing.path} customUrl={sharing.customUrl} published={sharing.published} busy={publishing} onPublish={() => publish(sharing)} onClose={() => setSharing(null)} />}

      {confirmDel && (
        <Modal title="Excluir esta página?" onClose={() => setConfirmDel(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>Cancelar</button><button className="btn btn-danger" onClick={() => remove(confirmDel)}>Excluir</button></>}>
          <p><strong>{confirmDel.name}</strong> será apagada e o link <strong>{pageUrl(confirmDel.path, confirmDel.customUrl).replace(/^https?:\/\//, '')}</strong> deixa de funcionar. Não dá para desfazer.</p>
        </Modal>
      )}
    </>
  );
}
