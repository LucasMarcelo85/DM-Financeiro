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
  const [levelKey, setLevelKey] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [busy, setBusy] = useState(false);

  async function load() {
    const result = await api.get('/inventory/flows');
    setFlows(result.flows);
    setFromFlowId((current) => current || String(result.flows.find((flow) => flow.isDefault)?.id || result.flows[0]?.id || ''));
    setToFlowId((current) => current || String(result.flows.find((flow) => flow.id !== Number(current))?.id || ''));
  }

  useEffect(() => {
    load().catch((error) => toast(error.message, 'error'));
  }, []);

  const source = flows.find((flow) => flow.id === Number(fromFlowId));
  const destination = flows.find((flow) => flow.id === Number(toFlowId));
  const availableLevels = useMemo(() => (source?.levels || []).filter((level) => level.stockEnabled && level.quantity > 0), [source]);
  const selected = availableLevels.find((level) => `${level.productId}:${level.variantKey}` === levelKey);

  useEffect(() => {
    if (!availableLevels.some((level) => `${level.productId}:${level.variantKey}` === levelKey)) {
      setLevelKey(availableLevels[0] ? `${availableLevels[0].productId}:${availableLevels[0].variantKey}` : '');
    }
  }, [availableLevels, levelKey]);

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

  async function transfer(event) {
    event.preventDefault();
    if (!selected || !destination || destination.id === source?.id) return;
    const amount = Number(quantity);
    if (!Number.isInteger(amount) || amount < 1 || amount > selected.quantity) {
      toast(`Informe uma quantidade entre 1 e ${selected.quantity}.`, 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post('/inventory/transfers', {
        fromFlowId: source.id,
        toFlowId: destination.id,
        items: [{ productId: selected.productId, variantKey: selected.variantKey, quantity: amount }],
      });
      setQuantity('1');
      await load();
      toast('Estoque movimentado entre os fluxos.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Fluxos de estoque" onClose={onClose}>
      <div className="inventory-manager">
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
          {!flows.length && <p className="muted">Carregando estoques...</p>}
        </div>

        <form className="inventory-create" onSubmit={createFlow}>
          <label>Nome do novo fluxo<input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="Ex.: Loja, Depósito, Expedição" /></label>
          <button className="btn btn-primary" type="submit" disabled={busy || name.trim().length < 2}><Icon name="plus" size={16} /> Criar fluxo</button>
        </form>

        <form className="inventory-transfer" onSubmit={transfer}>
          <h3>Movimentar estoque</h3>
          <label>Origem<select className="input" value={fromFlowId} onChange={(event) => setFromFlowId(event.target.value)}>
            {flows.map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
          </select></label>
          <label>Destino<select className="input" value={toFlowId} onChange={(event) => setToFlowId(event.target.value)}>
            {flows.filter((flow) => flow.id !== Number(fromFlowId)).map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
          </select></label>
          <label>Produto / variação<select className="input" value={levelKey} onChange={(event) => setLevelKey(event.target.value)} disabled={!availableLevels.length}>
            {availableLevels.map((level) => <option key={`${level.productId}:${level.variantKey}`} value={`${level.productId}:${level.variantKey}`}>
              {labelFor(level)} · {level.quantity} disponíveis
            </option>)}
          </select></label>
          <label>Quantidade<input className="input" type="number" min="1" max={selected?.quantity || 1} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
          {!availableLevels.length && <p className="muted small">Não há itens com estoque disponível no fluxo de origem.</p>}
          {flows.length < 2 && <p className="muted small">Crie pelo menos dois fluxos para fazer uma movimentação.</p>}
          <button className="btn btn-primary" type="submit" disabled={busy || !selected || !destination || flows.length < 2 || Number(quantity) > (selected?.quantity || 0)}>
            Movimentar para {destination?.name || 'outro fluxo'}
          </button>
        </form>
      </div>
    </Modal>
  );
}
