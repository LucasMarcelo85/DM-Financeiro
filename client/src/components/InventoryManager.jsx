import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';
import Icon from './Icon.jsx';
import { useToast } from './Toast.jsx';

const labelFor = (level) => level.variantKey === 'product'
  ? level.productName
  : `${level.productName} · ${level.variantLabel || level.variantKey.replace(/^image:/, 'variação ')}`;

export default function InventoryManager({ onClose }) {
  const toast = useToast();
  const [flows, setFlows] = useState([]);
  const [name, setName] = useState('');
  const [fromFlowId, setFromFlowId] = useState('');
  const [toFlowId, setToFlowId] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const result = await api.get('/inventory/flows');
    setFlows(result.flows);
    const defaultId = String(result.flows.find((flow) => flow.isDefault)?.id || result.flows[0]?.id || '');
    setFromFlowId((current) => current || defaultId);
    setToFlowId((current) => current || String(result.flows.find((flow) => String(flow.id) !== defaultId)?.id || ''));
  }

  useEffect(() => {
    load().catch((error) => toast(error.message, 'error'));
  }, []);

  const source = flows.find((flow) => flow.id === Number(fromFlowId));
  const destination = flows.find((flow) => flow.id === Number(toFlowId));
  const [filter, setFilter] = useState('');
  const [onlyStock, setOnlyStock] = useState(false);
  const [selection, setSelection] = useState({});
  const levels = useMemo(() => (source?.levels || []).filter((level) => level.stockEnabled), [source]);
  const visibleLevels = useMemo(() => {
    const term = filter.trim().toLocaleLowerCase('pt-BR');
    return levels
      .filter((level) => (!onlyStock || level.quantity > 0) && (!term || labelFor(level).toLocaleLowerCase('pt-BR').includes(term)))
      .sort((a, b) => labelFor(a).localeCompare(labelFor(b), 'pt-BR'));
  }, [levels, filter, onlyStock]);
  const picked = levels.map((level) => [level, selection[`${level.productId}:${level.variantKey}`] || 0]).filter(([, qty]) => qty > 0);
  const totalUnits = picked.reduce((sum, [, qty]) => sum + qty, 0);

  async function createFlow(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/inventory/flows', { name });
      setName('');
      await load();
      toast('Fluxo de estoque criado.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function renameFlow(flow) {
    const next = window.prompt('Nome do fluxo de estoque:', flow.name);
    if (next === null || next.trim() === flow.name) return;
    setBusy(true);
    try {
      await api.patch(`/inventory/flows/${flow.id}`, { name: next });
      await load();
      toast('Fluxo atualizado.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteFlow(flow) {
    if (!window.confirm(`Excluir o fluxo “${flow.name}”? Ele precisa estar vazio, sem pedidos vinculados, e não pode ser o fluxo padrão.`)) return;
    setBusy(true);
    try {
      await api.del(`/inventory/flows/${flow.id}`);
      await load();
      toast('Fluxo excluído.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function transfer() {
    if (!destination || destination.id === source?.id || !picked.length) return;
    setBusy(true);
    try {
      await api.post('/inventory/transfers', {
        fromFlowId: source.id,
        toFlowId: destination.id,
        items: picked.map(([level, qty]) => ({ productId: level.productId, variantKey: level.variantKey, quantity: qty })),
      });
      setSelection({});
      await load();
      toast(`${picked.length} item(ns) movimentado(s) para ${destination.name}.`);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const rowKey = (level) => `${level.productId}:${level.variantKey}`;
  const setQty = (level, value) => setSelection((current) => {
    const qty = Math.max(0, Math.min(level.quantity, Math.floor(Number(value) || 0)));
    const next = { ...current };
    if (qty > 0) next[rowKey(level)] = qty; else delete next[rowKey(level)];
    return next;
  });
  const destQty = (level) => destination?.levels.find((row) => rowKey(row) === rowKey(level))?.quantity || 0;
  const moveAllVisible = () => setSelection((current) => {
    const next = { ...current };
    for (const level of visibleLevels) if (level.quantity > 0) next[rowKey(level)] = level.quantity;
    return next;
  });
  const swap = () => { setFromFlowId(toFlowId); setToFlowId(fromFlowId); setSelection({}); };

  return (
    <Modal wide title="Estoques" onClose={onClose}>
      <div className="inventory-manager inv-board">
        <div className="inv-route">
          <label>Origem<select className="input" value={fromFlowId} onChange={(event) => { setFromFlowId(event.target.value); setSelection({}); if (event.target.value === toFlowId) setToFlowId(String(flows.find((flow) => String(flow.id) !== event.target.value)?.id || '')); }}>
            {flows.map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
          </select></label>
          <button type="button" className="btn btn-ghost" onClick={swap} disabled={flows.length < 2} title="Inverter origem e destino" aria-label="Inverter origem e destino"><Icon name="refresh" size={18} /></button>
          <label>Destino<select className="input" value={toFlowId} onChange={(event) => setToFlowId(event.target.value)}>
            {flows.filter((flow) => flow.id !== Number(fromFlowId)).map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
          </select></label>
        </div>
        {flows.length < 2 && <p className="muted small">Crie pelo menos dois fluxos (abaixo) para fazer uma movimentação.</p>}

        <div className="inv-toolbar">
          <input className="input" type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Buscar produto ou variação" aria-label="Buscar produto" />
          <label className="check-line"><input type="checkbox" checked={onlyStock} onChange={(event) => setOnlyStock(event.target.checked)} /><span>Só com estoque na origem</span></label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={moveAllVisible}>Mover tudo (listados)</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelection({})} disabled={!picked.length}>Limpar</button>
        </div>

        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead><tr><th>Produto / variação</th><th>Na origem</th><th>No destino</th><th>Mover</th><th /></tr></thead>
            <tbody>
              {visibleLevels.map((level) => {
                const qty = selection[rowKey(level)] || 0;
                return (
                  <tr key={rowKey(level)} className={`${qty ? 'is-picked' : ''} ${level.quantity === 0 ? 'is-empty' : ''}`}>
                    <td>{labelFor(level)}</td>
                    <td><strong>{level.quantity}</strong></td>
                    <td>{destQty(level)}</td>
                    <td><input className="input inv-qty" type="number" min="0" max={level.quantity} value={qty || ''} placeholder="0" disabled={level.quantity === 0} onChange={(event) => setQty(level, event.target.value)} aria-label={`Quantidade de ${labelFor(level)}`} /></td>
                    <td><button type="button" className="btn btn-ghost btn-sm" disabled={level.quantity === 0} onClick={() => setQty(level, qty === level.quantity ? 0 : level.quantity)}>{qty === level.quantity && qty > 0 ? 'Desfazer' : 'Tudo'}</button></td>
                  </tr>
                );
              })}
              {!visibleLevels.length && <tr><td colSpan="5" className="muted">Nenhum item encontrado.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted small">Itens com 0 na origem aparecem em cinza: use o botão de inverter para movê-los no sentido contrário. Produtos sem controle de estoque não entram aqui.</p>

        <div className="inv-actionbar">
          <span>{picked.length ? `${picked.length} item(ns) · ${totalUnits} unidade(s) para ${destination?.name || '...'}` : 'Marque as quantidades que deseja mover.'}</span>
          <button className="btn btn-primary" type="button" onClick={transfer} disabled={busy || !picked.length || !destination || picked.length > 100}>
            Movimentar {picked.length ? `${picked.length} item(ns)` : ''}
          </button>
        </div>
        {picked.length > 100 && <p className="form-error">Cada movimentação aceita até 100 itens. Remova alguns e repita.</p>}

        <details className="inv-flows">
          <summary>Gerenciar fluxos de estoque ({flows.length})</summary>
          <p className="muted">Separe o estoque por local ou operação. As transferências movimentam quantidades sem alterar o total de produtos do plano.</p>
          <div className="inventory-flow-list">
            {flows.map((flow) => (
              <article className="inventory-flow-card" key={flow.id}>
                <div><strong>{flow.name}</strong>{flow.isDefault && <span className="pill pill-sent">Padrão do catálogo</span>}</div>
                <small>{flow.levels.filter((level) => level.stockEnabled).length} itens com controle de estoque</small>
                <div className="inventory-flow-actions">
                  <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => renameFlow(flow)}>Renomear</button>
                  {!flow.isDefault && <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => deleteFlow(flow)}>Excluir</button>}
                </div>
              </article>
            ))}
          </div>
          <form className="inventory-create" onSubmit={createFlow}>
            <label>Nome do novo fluxo<input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="Ex.: Loja, Depósito, Expedição" /></label>
            <button className="btn btn-primary" type="submit" disabled={busy || name.trim().length < 2}><Icon name="plus" size={16} /> Criar fluxo</button>
          </form>
        </details>
      </div>
    </Modal>
  );
}
