import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import Modal from '../Modal.jsx';
import { formatStoredPhone } from '../../lib/format.js';

// Escolher um cliente (com busca) para preencher o contrato com os dados dele.
export default function ClientPicker({ title = 'Escolher cliente', onPick, onClose }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      api.get(`/contacts?q=${encodeURIComponent(q)}&limit=100`).then((r) => { setList(r.contacts); setError(''); }).catch((e) => setError(e.message));
    }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Modal title={title} onClose={onClose} footer={<button className="btn btn-ghost" onClick={onClose}>Cancelar</button>}>
      <input className="input" type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, telefone ou e-mail" aria-label="Buscar cliente" />
      {error && <p className="form-error" role="alert">{error}</p>}
      {list === null ? <p className="muted">Carregando...</p> : list.length === 0 ? (
        <p className="muted">{q ? 'Nenhum cliente encontrado.' : 'Você ainda não tem clientes cadastrados. Cadastre em Clientes para usar os dados deles nos contratos.'}</p>
      ) : (
        <ul className="cp-list">
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" className="cp-item" onClick={() => onPick(c)}>
                <strong>{c.name}</strong>
                <span className="muted small">{formatStoredPhone(c.phone)}{c.document ? '' : ' · sem CPF/CNPJ'}{c.street || c.city ? '' : ' · sem endereço'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
