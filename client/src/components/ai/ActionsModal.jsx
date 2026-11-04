import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import Icon from '../Icon.jsx';
import { useToast } from '../Toast.jsx';
import { formatStoredPhone } from '../../lib/format.js';

const EMPTY = { name: '', trigger: '', targetPhone: '', message: '', pauseAfter: false, active: true };
const EXAMPLE = {
  name: 'Chamar especialista',
  trigger: 'o cliente pedir para falar com um especialista, atendente humano ou tiver um problema que você não consegue resolver',
  message: '🔔 Atendimento IA: {{cliente}} ({{telefone}}) pediu um especialista.\nMotivo: {{resumo}}',
  pauseAfter: true,
};

export default function ActionsModal({ agent, onClose }) {
  const toast = useToast();
  const [actions, setActions] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try { setActions((await api.get(`/ai/agents/${agent.id}/actions`)).actions); } catch (error) { toast(error.message, 'error'); }
  }, [agent.id, toast]);
  useEffect(() => { load(); }, [load]);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      if (form.id) await api.put(`/ai/agents/${agent.id}/actions/${form.id}`, form);
      else await api.post(`/ai/agents/${agent.id}/actions`, form);
      setForm(null);
      await load();
    } catch (error) { toast(error.message, 'error'); }
    finally { setSaving(false); }
  }
  async function remove(action) {
    if (!window.confirm(`Excluir a função "${action.name}"?`)) return;
    try { await api.del(`/ai/agents/${agent.id}/actions/${action.id}`); await load(); } catch (error) { toast(error.message, 'error'); }
  }
  async function toggle(action) {
    try { await api.put(`/ai/agents/${agent.id}/actions/${action.id}`, { ...action, active: !action.active }); await load(); } catch (error) { toast(error.message, 'error'); }
  }

  return (
    <div className="ai-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="ai-editor" role="dialog" aria-modal="true" aria-label="Funções do agente">
        <div className="ai-editor-head">
          <div><h2>Funções de {agent.name}</h2><p className="muted small">Ações que o agente executa por fora da conversa. Ex.: se o cliente pedir um especialista, o sistema avisa um número no WhatsApp.</p></div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar"><Icon name="x" /></button>
        </div>
        {form ? (
          <form className="ai-form" onSubmit={save}>
            <label className="field"><span>Nome da função</span><input className="input" value={form.name} onChange={set('name')} required minLength={2} maxLength={80} placeholder="Ex.: Chamar especialista" /></label>
            <label className="field"><span>Quando executar</span><textarea className="input" rows={3} value={form.trigger} onChange={set('trigger')} required minLength={5} maxLength={500} placeholder="Ex.: o cliente pedir para falar com um especialista" /><small>Descreva a situação em linguagem natural; a IA decide quando ela ocorreu na conversa.</small></label>
            <label className="field"><span>Número que receberá o aviso</span><input className="input" value={form.targetPhone} onChange={set('targetPhone')} required placeholder="(85) 99999-9999" /><small>Enviado pela mesma instância do agente.</small></label>
            <label className="field"><span>Mensagem do aviso (opcional)</span><textarea className="input" rows={3} value={form.message} onChange={set('message')} maxLength={1500} placeholder="Deixe vazio para usar o texto padrão" /><small>Variáveis: {'{{cliente}}'}, {'{{telefone}}'}, {'{{resumo}}'}, {'{{agente}}'}.</small></label>
            <label className="ai-checkbox"><input type="checkbox" checked={form.pauseAfter} onChange={(event) => setForm((current) => ({ ...current, pauseAfter: event.target.checked }))} /> Interromper o agente nesta conversa depois do aviso</label>
            <div className="ai-editor-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setForm(null)} disabled={saving}>Voltar</button>
              <button className="btn btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar função'}</button>
            </div>
          </form>
        ) : (
          <div className="ai-form">
            {!actions && <p className="muted">Carregando...</p>}
            {actions && !actions.length && <p className="muted">Nenhuma função criada ainda.</p>}
            {actions?.map((action) => (
              <article className="ai-action-item" key={action.id}>
                <div><strong>{action.name}</strong> {!action.active && <span className="ai-agent-state">Desligada</span>}
                  <p className="muted small">Quando {action.trigger}</p>
                  <p className="muted small">Avisa {formatStoredPhone(action.targetPhone)}{action.pauseAfter ? ' · interrompe o agente' : ''}</p></div>
                <div className="btn-group">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(action)}>{action.active ? 'Desligar' : 'Ligar'}</button>
                  <button type="button" className="icon-btn" onClick={() => setForm({ ...EMPTY, ...action })} aria-label="Editar"><Icon name="edit" size={16} /></button>
                  <button type="button" className="icon-btn icon-btn-danger" onClick={() => remove(action)} aria-label="Excluir"><Icon name="trash" size={16} /></button>
                </div>
              </article>
            ))}
            <div className="ai-editor-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setForm({ ...EMPTY, ...EXAMPLE })}>Usar exemplo: chamar especialista</button>
              <button type="button" className="btn btn-primary" onClick={() => setForm({ ...EMPTY })}><Icon name="plus" size={17} /> Nova função</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
