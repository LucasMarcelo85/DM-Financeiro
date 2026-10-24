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
import { CATALOG_TEMPLATES, SITE_TEMPLATES, TEMPLATES, buildTemplate } from '../lib/portfolio/templates.js';

function TemplateGroup({ title, hint, list, value, onPick, disabled }) {
  return (
    <fieldset className="field" disabled={disabled}>
      <legend>{title}</legend>
      {hint && <small className="ct-group-hint">{hint}</small>}
      <div className="ct-templates">
        {list.map((t) => (
          <label key={t.key} className={`ct-template ${value === t.key ? 'is-on' : ''} ${disabled ? 'is-locked' : ''}`}>
            <input type="radio" name="ptpl" value={t.key} checked={value === t.key} onChange={() => onPick(t.key)} />
            <strong>{t.label}</strong>
            <span className="muted small">{t.desc}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function NewPageModal({ onClose, onCreate, busy, catalogOk }) {
  const [key, setKey] = useState('services');
  const [name, setName] = useState('');
  return (
    <Modal title="Nova página" onClose={busy ? () => {} : onClose} wide
      footer={<><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn btn-primary" onClick={() => onCreate(key, name)} disabled={busy}>{busy ? 'Criando...' : 'Criar e editar'}</button></>}>
      <label className="field"><span>Nome da página</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ex.: Apresentação da empresa" autoFocus /></label>
      <TemplateGroup title="Página livre" list={SITE_TEMPLATES} value={key} onPick={setKey} />
      <TemplateGroup title="Catálogo digital" list={CATALOG_TEMPLATES} value={key} onPick={setKey} disabled={!catalogOk}
        hint={catalogOk ? 'Vitrine de produtos com carrinho e pedido: duas páginas (início e carrinho), entrega por excursão, motoboy ou Correios.' : 'O seu plano não inclui o catálogo digital. Veja os planos para liberar.'} />
      {!catalogOk && <Link className="btn btn-ghost btn-sm" to="/plano" onClick={onClose}>Ver planos com catálogo</Link>}
      <small>Tudo pode ser trocado no editor: arraste elementos, mude cores, imagens, ícones, botões, animações e formatos.</small>
    </Modal>
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
      const doc = buildTemplate(key, user.name);
      const { portfolio } = await api.post('/portfolios', { name: name.trim() || tpl.label, kind: doc.kind, data: doc });
      nav(`/portfolio/${portfolio.id}`);
    } catch (e) { toast(e.message, 'error'); setBusy(''); }
  }

  async function copy(p) {
    if (await copyText(pageUrl(p.path))) toast('Link copiado!'); else setSharing(p);
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

      {data === null ? <p className="muted">Carregando...</p> : count === 0 ? (
        <section className="empty-hero">
          <span className="action-icon action-icon-lg"><Icon name="globe" size={32} /></span>
          <h2>Crie sua primeira página</h2>
          <p>Arraste textos, imagens, ícones, botões e formas para onde quiser, com desenho próprio para computador, tablet e celular. Depois copie o link e envie para quem quiser.</p>
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
                <span className="pl-url" title={pageUrl(p.path)}><Icon name="link" size={14} /><span>{pageUrl(p.path).replace(/^https?:\/\//, '')}</span></span>
                <span className="muted small">editada em {dateBR(p.updatedAt)}</span>
              </Link>
              <div className="ct-actions">
                <Link className="btn btn-primary btn-sm" to={`/portfolio/${p.id}`}><Icon name="edit" size={16} /> Editar</Link>
                <button className="btn btn-ghost btn-sm" onClick={() => copy(p)}><Icon name="copy" size={16} /> Copiar link</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSharing(p)}><Icon name="share" size={16} /> Compartilhar</button>
                <button className="icon-btn icon-btn-danger" onClick={() => setConfirmDel(p)} aria-label={`Excluir ${p.name}`} title="Excluir"><Icon name="trash" size={18} /></button>
              </div>
              <div className="pl-more">
                {p.published && <a className="link-btn" href={pageUrl(p.path)} target="_blank" rel="noopener noreferrer">Abrir página</a>}
                <button className="link-btn" onClick={() => duplicate(p)} disabled={full}>Duplicar</button>
                {!p.isMain && <button className="link-btn" onClick={() => makeMain(p)}>Tornar principal</button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {newOpen && <NewPageModal busy={busy === 'create'} catalogOk={(data?.catalogProducts ?? 0) > 0} onClose={() => setNewOpen(false)} onCreate={create} />}
      {sharing && <ShareModal name={sharing.name} path={sharing.path} published={sharing.published} busy={publishing} onPublish={() => publish(sharing)} onClose={() => setSharing(null)} />}

      {confirmDel && (
        <Modal title="Excluir esta página?" onClose={() => setConfirmDel(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>Cancelar</button><button className="btn btn-danger" onClick={() => remove(confirmDel)}>Excluir</button></>}>
          <p><strong>{confirmDel.name}</strong> será apagada e o link <strong>{pageUrl(confirmDel.path).replace(/^https?:\/\//, '')}</strong> deixa de funcionar. Não dá para desfazer.</p>
        </Modal>
      )}
    </>
  );
}
