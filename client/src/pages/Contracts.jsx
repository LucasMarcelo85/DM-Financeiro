import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { dateBR, plural } from '../lib/format.js';
import { IMPORT_ACCEPT, importFile } from '../lib/contract/import.js';
import { TEMPLATES, buildTemplate } from '../lib/contract/templates.js';

function NewContractModal({ onClose, onCreate, busy }) {
  const [key, setKey] = useState('blank');
  const [name, setName] = useState('');
  return (
    <Modal title="Novo contrato" onClose={busy ? () => {} : onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn btn-primary" onClick={() => onCreate(key, name)} disabled={busy}>{busy ? 'Criando...' : 'Criar e editar'}</button></>}>
      <label className="field"><span>Nome do contrato</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ex.: Contrato de prestação de serviços" autoFocus /></label>
      <fieldset className="field">
        <legend>Começar de</legend>
        <div className="ct-templates">
          {TEMPLATES.map((t) => (
            <label key={t.key} className={`ct-template ${key === t.key ? 'is-on' : ''}`}>
              <input type="radio" name="tpl" value={t.key} checked={key === t.key} onChange={() => setKey(t.key)} />
              <strong>{t.label}</strong>
              <span className="muted small">{t.desc}</span>
            </label>
          ))}
        </div>
        <small>Os modelos prontos são exemplos: revise e ajuste o texto antes de usar com clientes.</small>
      </fieldset>
    </Modal>
  );
}

export default function Contracts() {
  const toast = useToast();
  const nav = useNavigate();
  const fileRef = useRef(null);
  const [data, setData] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);
  const [report, setReport] = useState(null); // avisos depois de importar

  const load = useCallback(() => {
    api.get('/contracts').then(setData).catch((e) => toast(e.message, 'error'));
  }, [toast]);
  useEffect(load, [load]);

  const full = data && data.contracts.length >= data.limit;

  async function create(key, name) {
    setBusy('create');
    try {
      const tpl = TEMPLATES.find((t) => t.key === key);
      const doc = await buildTemplate(key);
      const { contract } = await api.post('/contracts', { name: name.trim() || (key === 'blank' ? 'Contrato sem título' : tpl.label), data: doc });
      nav(`/contratos/${contract.id}`);
    } catch (e) { toast(e.message, 'error'); setBusy(''); }
  }

  async function onFile(file) {
    if (!file) return;
    setBusy('import');
    try {
      const r = await importFile(file);
      const { contract } = await api.post('/contracts', { name: r.name, data: r.doc });
      if (r.notes.length) { setReport({ id: contract.id, notes: r.notes }); setBusy(''); load(); } else nav(`/contratos/${contract.id}`);
    } catch (e) { toast(e.message || 'Não foi possível importar o arquivo.', 'error'); setBusy(''); }
  }

  async function duplicate(c) {
    try { await api.post(`/contracts/${c.id}/duplicate`); toast('Contrato duplicado.'); load(); } catch (e) { toast(e.message, 'error'); }
  }

  async function remove(c) {
    setConfirmDel(null);
    try { await api.del(`/contracts/${c.id}`); toast('Contrato excluído.'); load(); } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <>
      <header className="page-head head-row">
        <div>
          <h1>Contratos</h1>
          <p className="muted">
            Crie modelos do zero ou importe um arquivo e edite: logo, textos, fontes, cores e layout.
            {data ? ` Você usou ${data.contracts.length} de ${plural(data.limit, 'modelo', 'modelos')} do seu plano.` : ''}
          </p>
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={!data || full || !!busy}><Icon name="file" size={18} /> {busy === 'import' ? 'Importando...' : 'Importar modelo'}</button>
          <button className="btn btn-primary" onClick={() => setNewOpen(true)} disabled={!data || full || !!busy}><Icon name="plus" size={18} /> Novo contrato</button>
        </div>
      </header>
      <input ref={fileRef} type="file" accept={IMPORT_ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onFile(f); }} />

      {full && (
        <div className="banner banner-amber">
          <div><strong>Você usou todos os modelos do seu plano.</strong><span>Exclua um modelo ou mude de plano para criar mais.</span></div>
          <Link className="btn btn-ghost btn-sm" to="/plano">Ver planos</Link>
        </div>
      )}

      {data === null ? <p className="muted">Carregando...</p> : data.contracts.length === 0 ? (
        <section className="empty-hero">
          <span className="action-icon action-icon-lg"><Icon name="file" size={32} /></span>
          <h2>Crie seu primeiro contrato</h2>
          <p>Comece do zero com um modelo pronto ou importe um arquivo do Word (.docx), HTML, texto ou imagem e edite do seu jeito.</p>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => setNewOpen(true)}>Novo contrato</button>
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>Importar modelo</button>
          </div>
        </section>
      ) : (
        <ul className="ct-grid">
          {data.contracts.map((c) => (
            <li key={c.id} className="ct-card">
              <Link to={`/contratos/${c.id}`} className="ct-main">
                <span className="action-icon"><Icon name="file" size={22} /></span>
                <strong title={c.name}>{c.name}</strong>
                <span className="muted small">{plural(c.pageCount, 'página', 'páginas')} · editado em {dateBR(c.updatedAt)}</span>
              </Link>
              <div className="ct-actions">
                <Link className="btn btn-primary btn-sm" to={`/contratos/${c.id}`}><Icon name="edit" size={16} /> Editar</Link>
                <button className="btn btn-ghost btn-sm" onClick={() => duplicate(c)} disabled={full}>Duplicar</button>
                <button className="icon-btn icon-btn-danger" onClick={() => setConfirmDel(c)} aria-label={`Excluir ${c.name}`} title="Excluir"><Icon name="trash" size={18} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {newOpen && <NewContractModal busy={busy === 'create'} onClose={() => setNewOpen(false)} onCreate={create} />}

      {report && (
        <Modal title="Arquivo importado" onClose={() => { load(); setReport(null); }}
          footer={<button className="btn btn-primary" onClick={() => nav(`/contratos/${report.id}`)}>Abrir no editor</button>}>
          <p>Importamos o conteúdo. Alguns detalhes precisam de ajuste no editor:</p>
          <ul className="ct-notes">{report.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </Modal>
      )}

      {confirmDel && (
        <Modal title="Excluir este contrato?" onClose={() => setConfirmDel(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setConfirmDel(null)}>Cancelar</button><button className="btn btn-danger" onClick={() => remove(confirmDel)}>Excluir</button></>}>
          <p><strong>{confirmDel.name}</strong> será apagado e não dá para desfazer. Dica: use "Baixar modelo" no editor para guardar uma cópia.</p>
        </Modal>
      )}
    </>
  );
}
