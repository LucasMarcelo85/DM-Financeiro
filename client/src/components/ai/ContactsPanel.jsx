import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import CsvTransfer from '../CsvTransfer.jsx';
import Icon from '../Icon.jsx';
import { useToast } from '../Toast.jsx';
import { formatStoredPhone } from '../../lib/format.js';
import { importCsvBatches } from '../../lib/csv.js';

const CONTACT_COLUMNS = [
  { key: 'name', type: 'string' }, { key: 'phone', type: 'string' }, { key: 'email', type: 'string' },
  { key: 'notes', type: 'string' }, { key: 'document', type: 'string' }, { key: 'zip', type: 'string' },
  { key: 'street', type: 'string' }, { key: 'number', type: 'string' }, { key: 'complement', type: 'string' },
  { key: 'district', type: 'string' }, { key: 'city', type: 'string' }, { key: 'state', type: 'string' },
  { key: 'createdAt', type: 'date' },
];

export default function ContactsPanel({ folders, onChanged }) {
  const toast = useToast();
  const [selectedId, setSelectedId] = useState('pedidos');
  const [importDestinationId, setImportDestinationId] = useState('cobrancas');
  const [newFolder, setNewFolder] = useState('');
  const [contact, setContact] = useState({ name: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const visibleFolders = useMemo(() => folders.filter((item) => !item.system || item.contacts.length > 0), [folders]);
  const folder = visibleFolders.find((item) => item.id === selectedId) || visibleFolders[0];
  const customFolders = useMemo(() => folders.filter((item) => !item.system), [folders]);
  const targets = customFolders.filter((item) => item.id !== folder?.id);
  useEffect(() => {
    if (folder && folder.id !== selectedId) setSelectedId(folder.id);
    if (importDestinationId !== 'cobrancas' && !customFolders.some((item) => String(item.folderId) === importDestinationId)) {
      setImportDestinationId('cobrancas');
    }
  }, [customFolders, folder, importDestinationId, selectedId]);
  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!folder || !term) return folder?.contacts || [];
    const digits = term.replace(/\D/g, '');
    return folder.contacts.filter((item) => item.name.toLowerCase().includes(term) || (digits && item.phone.includes(digits)));
  }, [folder, filter]);

  async function run(action, success) {
    setBusy(true);
    try {
      await action();
      if (success) toast(success);
      await onChanged();
    } catch (error) { toast(error.message, 'error'); }
    finally { setBusy(false); }
  }
  const createFolder = (event) => {
    event.preventDefault();
    const name = newFolder.trim();
    if (!name) return;
    run(async () => {
      const result = await api.post('/ai/folders', { name });
      setNewFolder('');
      setSelectedId(`f${result.folder.id}`);
    }, 'Pasta criada.');
  };
  const renameFolder = () => {
    const name = window.prompt('Novo nome da pasta:', folder.name);
    if (name && name.trim() !== folder.name) run(() => api.put(`/ai/folders/${folder.folderId}`, { name }), 'Pasta renomeada.');
  };
  const deleteFolder = () => {
    if (!window.confirm(`Excluir a pasta "${folder.name}"? Os contatos continuam nas outras pastas.`)) return;
    run(async () => { await api.del(`/ai/folders/${folder.folderId}`); setSelectedId('pedidos'); }, 'Pasta excluída.');
  };
  const addContact = (event) => {
    event.preventDefault();
    run(async () => {
      await api.post(`/ai/folders/${folder.folderId}/contacts`, { contacts: [contact] });
      setContact({ name: '', phone: '' });
    }, 'Contato adicionado.');
  };
  const transferTo = (item, target) => {
    const [action, targetId] = target.split(':');
    if (!targetId) return;
    run(async () => {
      await api.post(`/ai/folders/${targetId}/contacts`, { contacts: [{ name: item.name, phone: item.phone }] });
      if (action === 'move') await api.del(`/ai/folders/${folder.folderId}/contacts/${item.phone}`);
    }, action === 'move' ? 'Contato movido.' : 'Contato adicionado à pasta.');
  };
  const copyAll = (targetId) => {
    if (!targetId) return;
    const contacts = folder.contacts.slice(0, 500).map((item) => ({ name: item.name, phone: item.phone }));
    run(() => api.post(`/ai/folders/${targetId}/contacts`, { contacts }), `${contacts.length} contato(s) adicionados à pasta.`);
  };
  const removeContact = (item) => run(() => api.del(`/ai/folders/${folder.folderId}/contacts/${item.phone}`), 'Contato removido da pasta.');

  return (
    <section className="ai-contacts-panel">
      <header>
        <div>
          <h2>Contatos em pastas</h2>
          <p className="muted">Organize os números como pastas. “Pedidos” e “Cobranças” são automáticas; crie outras pastas e adicione números quando quiser.</p>
        </div>
        <CsvTransfer resource="contacts" title="clientes" filename="clientes.csv" exportUrl="/contacts/export" columns={CONTACT_COLUMNS}
          description="Importa e exporta os clientes das cobranças. Ao importar para uma pasta personalizada, são salvos somente nome e telefone."
          importDestination={{
            label: 'Importar para',
            value: importDestinationId,
            onChange: setImportDestinationId,
            options: [['cobrancas', 'Clientes de cobranças'], ...customFolders.map((item) => [String(item.folderId), item.name])],
          }}
          onImport={async (contacts) => {
            const result = importDestinationId === 'cobrancas'
              ? await importCsvBatches(contacts, (batch) => api.post('/contacts/import', { contacts: batch }), 500, 2 * 1024 * 1024)
              : await importCsvBatches(contacts, async (batch) => {
                const target = customFolders.find((item) => String(item.folderId) === importDestinationId);
                if (!target) throw new Error('A pasta de destino não existe mais. Atualize a página e tente novamente.');
                const result = await api.post(`/ai/folders/${target.folderId}/contacts`, {
                  contacts: batch.map(({ name, phone }) => ({ name, phone })),
                });
                return {
                  created: result.added,
                  errors: (result.invalid || []).map((phone) => ({
                    row: Math.max(2, batch.findIndex((item) => item.phone === phone) + 2),
                    message: `Telefone inválido: ${phone}`,
                  })),
                };
              }, 500, 2 * 1024 * 1024);
            await onChanged();
            return result;
          }}
        />
      </header>
      <div className="ai-folders-layout">
        <aside className="ai-folder-list" aria-label="Pastas de contatos">
          {visibleFolders.map((item) => (
            <button type="button" key={item.id} className={item.id === folder.id ? 'is-selected' : ''} onClick={() => { setSelectedId(item.id); setFilter(''); }}>
              <Icon name={item.system ? 'users' : 'folder'} size={17} />
              <span>{item.name}</span><small>{item.contacts.length}</small>
            </button>
          ))}
          <form className="ai-folder-new" onSubmit={createFolder}>
            <input className="input" value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder="Nova pasta" maxLength={60} aria-label="Nome da nova pasta" />
            <button className="btn btn-ghost btn-sm" disabled={busy || newFolder.trim().length < 2} aria-label="Criar pasta"><Icon name="plus" size={16} /></button>
          </form>
        </aside>
        {folder ? <div className="ai-folder-body">
          <div className="ai-folder-head">
            <h3>{folder.name} <small>({folder.contacts.length})</small></h3>
            <div className="btn-group">
              {!folder.system && <button type="button" className="btn btn-ghost btn-sm" onClick={renameFolder} disabled={busy}>Renomear</button>}
              {!folder.system && <button type="button" className="btn btn-ghost btn-sm icon-btn-danger" onClick={deleteFolder} disabled={busy}>Excluir pasta</button>}
              {folder.system && targets.length > 0 && folder.contacts.length > 0 && (
                <select className="input ai-inline-select" value="" onChange={(event) => copyAll(event.target.value)} disabled={busy} aria-label="Copiar todos para uma pasta">
                  <option value="">Copiar todos para…</option>
                  {targets.map((item) => <option key={item.id} value={item.folderId}>{item.name}</option>)}
                </select>
              )}
            </div>
          </div>
          {!folder.system && (
            <form className="ai-add-contact" onSubmit={addContact}>
              <input className="input" value={contact.name} onChange={(event) => setContact((current) => ({ ...current, name: event.target.value }))} placeholder="Nome (opcional)" maxLength={120} aria-label="Nome do contato" />
              <input className="input" value={contact.phone} onChange={(event) => setContact((current) => ({ ...current, phone: event.target.value }))} placeholder="(85) 99999-9999" required inputMode="tel" aria-label="Telefone do contato" />
              <button className="btn btn-primary btn-sm" disabled={busy}><Icon name="plus" size={16} /> Adicionar número</button>
            </form>
          )}
          {folder.contacts.length > 8 && <input className="input" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Buscar por nome ou número" aria-label="Buscar contato" />}
          <div className="ai-contact-table">
            <div className="ai-contact-table-head"><span>Nome</span><span>Telefone</span><span>Pasta</span></div>
            {visible.map((item) => (
              <div className="ai-contact-row" key={item.phone}>
                <strong>{item.name}</strong>
                <span>{formatStoredPhone(item.phone)}</span>
                <span className="ai-contact-actions">
                  {targets.length > 0 && (
                    <select className="input ai-inline-select" value="" onChange={(event) => transferTo(item, event.target.value)} disabled={busy} aria-label="Enviar contato para outra pasta">
                      <option value="">Enviar para outra pasta…</option>
                      {targets.flatMap((target) => [
                        <option key={`copy-${target.id}`} value={`copy:${target.folderId}`}>Copiar para {target.name}</option>,
                        ...(!folder.system ? [<option key={`move-${target.id}`} value={`move:${target.folderId}`}>Mover para {target.name}</option>] : []),
                      ])}
                    </select>
                  )}
                  {!folder.system && <button type="button" className="icon-btn icon-btn-danger" onClick={() => removeContact(item)} disabled={busy} aria-label={`Remover ${item.name}`}><Icon name="trash" size={16} /></button>}
                </span>
              </div>
            ))}
            {!visible.length && <p className="muted">{folder.system ? 'Nenhum contato com telefone nesta pasta ainda.' : 'Pasta vazia. Adicione números acima ou copie contatos das pastas de Pedidos e Cobranças.'}</p>}
          </div>
        </div> : <p className="muted">Nenhuma pasta disponível. Crie uma pasta ou importe clientes para começar.</p>}
      </div>
    </section>
  );
}
