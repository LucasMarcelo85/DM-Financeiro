import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, getActiveStore } from '../api.js';
import BuyMore from '../components/BuyMore.jsx';
import StoreBar from '../components/StoreBar.jsx';
import StoreAppModal from '../components/StoreAppModal.jsx';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import NewPortfolioWizard from '../components/portfolio/NewPortfolioWizard.jsx';
import ShareModal from '../components/portfolio/ShareModal.jsx';
import { useToast } from '../components/Toast.jsx';
import { dateBR, plural } from '../lib/format.js';
import { pageUrl } from '../lib/portfolio/model.js';
import { copyText } from '../lib/portfolio/share.js';
import { buildTemplate } from '../lib/portfolio/templates.js';

function DomainCard({ domain, onChange, locked }) {
  const toast = useToast();
  const [value, setValue] = useState(domain.name);
  const [busy, setBusy] = useState('');
  useEffect(() => setValue(domain.name), [domain.name]);
  const store = getActiveStore();
  const prefix = store ? `/stores/${store}` : '/portfolios';
  const saved = Boolean(domain.name);
  const changed = value.trim() !== domain.name;

  async function run(kind, fn, message) {
    setBusy(kind);
    try {
      const result = await fn();
      toast(message(result));
      await onChange();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  const save = () => run('save', () => api.put(`${prefix}/domain`, { domain: value }), (r) =>
    r.domain.verified ? 'Domínio ativo! Seu site já abre nele.' : 'Domínio salvo. Falta apontar o DNS (veja abaixo).');
  const remove = () => run('remove', () => api.put(`${prefix}/domain`, { domain: '' }), () => 'Domínio removido.');
  const check = () => run('check', () => api.post(`${prefix}/domain/check`), (r) =>
    r.domain.verified ? 'Domínio ativo! Seu site já abre nele.' : 'Ainda não encontrei o apontamento. O DNS pode levar de minutos a algumas horas.');

  return (
    <section className="pl-domain">
      <div className="pl-domain-head">
        <span className="action-icon"><Icon name="link" size={22} /></span>
        <div>
          <strong>Domínio próprio</strong>
          <span className="muted small">Use o endereço do seu site (ex.: <code>meusite.com.br</code>) em vez do endereço do sistema. A página principal abre direto nele e as outras ficam depois da barra.</span>
        </div>
        {locked && <span className="pill pill-failed"><Icon name="lock" size={13} /> Bloqueado no teste</span>}
        {saved && <span className={`pill ${domain.verified ? 'pill-sent' : 'pill-partial'}`}>{domain.verified ? 'Ativo' : 'Aguardando DNS'}</span>}
      </div>
      <div className="pl-domain-row">
        <input className="input" value={value} onChange={(e) => setValue(e.target.value)} maxLength={253} placeholder="meusite.com.br" aria-label="Seu domínio" inputMode="url" autoCapitalize="none" spellCheck={false} disabled={locked} />
        <button className="btn btn-primary" onClick={save} disabled={locked || !!busy || !value.trim() || !changed}>{busy === 'save' ? 'Salvando...' : 'Salvar domínio'}</button>
        {saved && <button className="btn btn-ghost" onClick={remove} disabled={locked || !!busy}>{busy === 'remove' ? 'Removendo...' : 'Remover'}</button>}
      </div>
      {locked && <p className="muted small">Domínio próprio fica disponível após adquirir um plano. Durante o teste grátis, este campo permanece bloqueado.</p>}
      {saved && !domain.verified && (
        <div className="banner banner-amber">
          <div>
            <strong>Falta apontar o domínio para o sistema.</strong>
            <span>No painel onde você registrou o domínio, crie um registro <b>tipo A</b> com nome <b>@</b>{domain.serverIp ? <> apontando para <code>{domain.serverIp}</code></> : ' apontando para o IP do servidor'}. Para o <b>www</b>, crie outro registro A com nome <b>www</b>. No Cloudflare, deixe a nuvem cinza (somente DNS).</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={check} disabled={locked || !!busy}>{busy === 'check' ? 'Verificando...' : 'Verificar agora'}</button>
        </div>
      )}
      {!saved && domain.serverIp && <p className="muted small">Aponte o DNS do seu domínio (registro tipo A) para o IP <code>{domain.serverIp}</code>.</p>}
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
  const [appOpen, setAppOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(() => api.get('/portfolios').then((r) => alive.current && setData(r)).catch((e) => toast(e.message, 'error')), [toast]);
  useEffect(() => { load(); }, [load]);

  const count = data?.used ?? data?.portfolios.length ?? 0;
  const full = data && count >= data.limit;

  async function create(options) {
    setBusy('create');
    try {
      const doc = buildTemplate(options.template, user.name);
      doc.theme = { ...doc.theme, ...options.theme };
      doc.seo = { ...doc.seo, title: options.name };
      const whatsapp = options.catalog ? options.catalogWhatsapp : options.whatsapp;
      if (whatsapp) {
        doc.elements = doc.elements.map((element) => {
          if (element.t !== 'button') return element;
          const directCatalogButton = options.catalog?.orderMode === 'direct' && ['cart', 'bag'].includes(element.icon);
          if (element.link?.kind !== 'whatsapp' && !directCatalogButton) return element;
          return {
            ...element,
            link: directCatalogButton
              ? { ...element.link, kind: 'whatsapp', phone: whatsapp }
              : { ...element.link, phone: whatsapp },
            ...(directCatalogButton
              ? { label: 'Pedir pelo WhatsApp', icon: 'zap' }
              : {}),
          };
        });
      }
      if (doc.kind === 'catalog' && options.catalog) {
        doc.catalog = {
          ...doc.catalog,
          ...options.catalog,
          card: { ...doc.catalog.card, ...options.catalog.card },
        };
      }
      const { portfolio } = await api.post('/portfolios', { name: options.name, kind: doc.kind, data: doc });
      nav(`/portfolio/${portfolio.id}`);
    } catch (e) { toast(e.message, 'error'); setBusy(''); }
  }

  async function copy(p) {
    if (await copyText(pageUrl(p.path, p.customUrl))) toast('Link copiado!'); else setSharing(p);
  }

  async function duplicate(p) {
    try { await api.post(`/portfolios/${p.id}/duplicate`); toast('Página duplicada.'); load(); } catch (e) { toast(e.message, 'error'); }
  }

  async function exportPage(p) {
    try {
      const { portfolio } = await api.get(`/portfolios/${p.id}`);
      const file = { format: 'dm-portfolio', version: 1, name: portfolio.name, kind: portfolio.kind, data: portfolio.data };
      const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(portfolio.name || 'portfolio').replace(/[^\w-]+/g, '-').toLowerCase()}.portfolio.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Portfólio exportado.');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function importFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy('import');
    try {
      let file;
      try { file = JSON.parse(await f.text()); } catch { throw new Error('Arquivo inválido: não é um JSON.'); }
      if (file?.format !== 'dm-portfolio' || !file.data) throw new Error('Arquivo inválido: não é um portfólio exportado.');
      const { portfolio } = await api.post('/portfolios', { name: String(file.name || 'Portfólio importado').slice(0, 120), kind: file.kind, data: file.data });
      toast('Portfólio importado.');
      nav(`/portfolio/${portfolio.id}`);
    } catch (err) { toast(err.message, 'error'); setBusy(''); }
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

  const base = data ? pageUrl(`/${data.userSlug}`, data.domain?.verified ? `https://${data.domain.name}` : '').replace(/^https?:\/\//, '') : '';

  if (newOpen) {
    return (
      <NewPortfolioWizard
        catalogOk={(data?.catalogProducts ?? 0) > 0}
        busy={busy === 'create'}
        onClose={() => setNewOpen(false)}
        onCreate={create}
      />
    );
  }

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
        {getActiveStore() && <button className="btn btn-ghost" onClick={() => setAppOpen(true)}><Icon name="box" size={18} /> Criar app</button>}
        <label className={`btn btn-ghost ${!data || full || busy ? 'is-disabled' : ''}`} aria-disabled={!data || full || !!busy}>
          Importar
          <input type="file" accept=".json,application/json" hidden onChange={importFile} disabled={!data || full || !!busy} />
        </label>
        <button className="btn btn-primary" onClick={() => setNewOpen(true)} disabled={!data || full || !!busy}><Icon name="plus" size={18} /> Nova página</button>
      </header>

      <StoreBar manage />
      {appOpen && <StoreAppModal storeId={getActiveStore()} onClose={() => setAppOpen(false)} />}

      {full && (
        <div className="banner banner-amber">
          <div><strong>Você usou todas as páginas do seu plano.</strong><span>Exclua uma página, adquira limite extra ou mude de plano para criar mais.</span></div>
          <BuyMore resource="portfolios" />
          <Link className="btn btn-ghost btn-sm" to="/plano">Ver planos</Link>
        </div>
      )}

      {data && (
        <div className="pl-addr">
          <span className="action-icon"><Icon name="globe" size={22} /></span>
          <div>
            <strong>Seu endereço</strong>
            <code>{base}</code>
            <span className="muted small">A página principal abre aqui; as outras ficam depois da barra.</span>
          </div>
        </div>
      )}
      {data && <DomainCard domain={data.domain} onChange={load} locked={false} />}

      {data === null ? <p className="muted">Carregando...</p> : count === 0 ? (
        <section className="empty-hero">
          <span className="action-icon action-icon-lg"><Icon name="globe" size={32} /></span>
          <h2>Crie sua primeira página</h2>
          <p>Arraste textos, imagens, ícones, botões e formas para onde quiser, com desenho próprio para computador, tablet e celular. Depois copie o link e envie para quem quiser.</p>
          {getActiveStore() && <button className="btn btn-ghost" onClick={() => setAppOpen(true)}><Icon name="box" size={18} /> Criar app</button>}
        <button className="btn btn-primary" onClick={() => setNewOpen(true)}>Nova página</button>
        </section>
      ) : (
        <ul className="ct-grid">
          {data.portfolios.map((p) => (
            <li key={p.id} className="ct-card">
              <Link to={`/portfolio/${p.id}`} className="ct-main">
                <span className="action-icon"><Icon name={p.kind === 'catalog' ? 'box' : 'globe'} size={22} /></span>
                <strong title={p.name}>{p.name}</strong>
                <span className="pl-badges">
                  <span className={`pill ${p.published ? 'pill-sent' : 'pill-partial'}`}>{p.published ? 'Publicada' : 'Rascunho'}</span>
                  {p.isMain && <span className="tag tag-monthly">Principal</span>}
                  {p.kind === 'catalog' && <span className="tag tag-catalog">Catálogo</span>}
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
                <button className="link-btn" onClick={() => exportPage(p)}>Exportar</button>
                {!p.isMain && <button className="link-btn" onClick={() => makeMain(p)}>Tornar principal</button>}
              </div>
            </li>
          ))}
        </ul>
      )}

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
