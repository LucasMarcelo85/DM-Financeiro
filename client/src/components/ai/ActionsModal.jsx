import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import Icon from '../Icon.jsx';
import { useToast } from '../Toast.jsx';
import { formatStoredPhone } from '../../lib/format.js';

const EMPTY = { name: '', trigger: '', kind: 'notify', targetPhone: '', message: '', config: { pixKey: '', maxAmountCents: 1000000 }, pauseAfter: false, active: true };
const EXAMPLE = {
  name: 'Chamar especialista',
  trigger: 'o cliente pedir para falar com um especialista, atendente humano ou tiver um problema que você não consegue resolver',
  kind: 'notify',
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
  const setConfig = (key) => (event) => setForm((current) => ({ ...current, config: { ...current.config, [key]: event.target.value } }));
  const setMaxAmount = (event) => setForm((current) => ({
    ...current,
    config: { ...current.config, maxAmountCents: Math.round(Number(event.target.value) * 100) },
  }));

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
            <label className="field"><span>O que esta função faz?</span>
              <select className="input" value={form.kind || 'notify'} onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value }))}>
                <option value="notify">Chamar atendimento humano</option>
                <option value="payment_link">Criar link de pagamento InfinitePay</option>
                <option value="pix">Enviar chave Pix</option>
                <option value="label">Aplicar etiqueta à conversa</option>
                <option value="note">Salvar anotação interna</option>
              </select>
            </label>
            <label className="field"><span>Quando executar</span><textarea className="input" rows={3} value={form.trigger} onChange={set('trigger')} required minLength={5} maxLength={500} placeholder="Ex.: o cliente pedir para falar com um especialista" /><small>Descreva a situação em linguagem natural; a IA decide quando ela ocorreu na conversa.</small></label>
            {(form.kind || 'notify') === 'notify' && <label className="field"><span>Número que receberá o aviso</span><input className="input" value={form.targetPhone} onChange={set('targetPhone')} required placeholder="(85) 99999-9999" /><small>Enviado pela mesma instância do agente.</small></label>}
            {form.kind === 'payment_link' && <div className="field"><span>Limite máximo por link (R$)</span>
              <input className="input" type="number" min="1" max="1000000" step="0.01" value={(Number(form.config?.maxAmountCents || 1000000) / 100).toFixed(2)} onChange={setMaxAmount} required />
              <small>Exige uma InfiniteTag conectada nas configurações de pagamento. O agente só cria links até este limite; o pagamento é reconhecido pela confirmação da InfinitePay.</small>
            </div>}
            {form.kind === 'pix' && <label className="field"><span>Chave Pix {form.config?.pixKeyConfigured && <small>(em branco mantém a chave atual)</small>}</span>
              <input className="input" value={form.config?.pixKey || ''} onChange={setConfig('pixKey')} required={!form.config?.pixKeyConfigured} maxLength={140} placeholder={form.config?.pixKeyConfigured ? '••••••••••••' : 'CPF, CNPJ, e-mail, telefone ou chave aleatória'} />
              <small>A IA envia a chave, mas não confirma automaticamente um Pix manual. A confirmação deve vir da integração bancária ou de um responsável.</small>
            </label>}
            {form.kind === 'pix' && <label className="field"><span>Limite máximo por cobrança Pix (R$)</span>
              <input className="input" type="number" min="1" max="1000000" step="0.01" value={(Number(form.config?.maxAmountCents || 1000000) / 100).toFixed(2)} onChange={setMaxAmount} required />
            </label>}
            {['notify', 'payment_link', 'pix'].includes(form.kind || 'notify') && <label className="field"><span>Mensagem para envio (opcional)</span><textarea className="input" rows={3} value={form.message} onChange={set('message')} maxLength={1500} placeholder="Deixe vazio para usar o texto padrão" /><small>Variáveis: {'{{cliente}}'}, {'{{telefone}}'}, {'{{resumo}}'}, {'{{agente}}'}, {'{{link}}'}, {'{{valor}}'}, {'{{chave_pix}}'}.</small></label>}
            {form.kind === 'label' && <p className="muted small">A IA pode criar e adicionar etiquetas curtas a esta conversa. Elas ficam visíveis no painel e no contexto do próprio agente.</p>}
            {form.kind === 'note' && <p className="muted small">A IA pode registrar um resumo interno na conversa. A anotação não é enviada ao cliente.</p>}
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
                  <p className="muted small">{action.kind === 'notify' || !action.kind
                    ? `Avisa ${formatStoredPhone(action.targetPhone)}`
                    : action.kind === 'payment_link' ? `Cria link até R$ ${(Number(action.config?.maxAmountCents || 1000000) / 100).toFixed(2).replace('.', ',')}`
                      : action.kind === 'pix' ? 'Envia a chave Pix configurada'
                        : action.kind === 'label' ? 'Aplica etiqueta à conversa' : 'Salva anotação interna'}{action.pauseAfter ? ' · interrompe o agente' : ''}</p></div>
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
