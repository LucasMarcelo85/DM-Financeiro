import { useState } from 'react';
import { api } from '../../api.js';
import Icon from '../Icon.jsx';
import { useToast } from '../Toast.jsx';

const MODE_LABEL = { atendimento: 'Atendimento', marketing: 'Marketing' };
const EMPTY = { id: null, name: '', mode: 'atendimento', content: '' };

export default function PromptsPanel({ prompts, builtin, onChanged }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const match = (item) => !filter || item.mode === filter;

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = { name: form.name, mode: form.mode, content: form.content };
      if (form.id) await api.put(`/ai/prompts/${form.id}`, payload);
      else await api.post('/ai/prompts', payload);
      toast('Prompt salvo.');
      setForm(null);
      await onChanged();
    } catch (error) { toast(error.message, 'error'); }
    finally { setSaving(false); }
  }
  async function remove(prompt) {
    if (!window.confirm(`Excluir o prompt "${prompt.name}"? Agentes que já o usam continuam com o texto atual.`)) return;
    try {
      await api.del(`/ai/prompts/${prompt.id}`);
      toast('Prompt excluído.');
      await onChanged();
    } catch (error) { toast(error.message, 'error'); }
  }

  return (
    <section className="ai-prompts-panel">
      <header className="ai-prompts-head">
        <div>
          <h2>Prompts</h2>
          <p className="muted">Crie quantos prompts quiser, marque como marketing ou atendimento e escolha qual usar em cada agente. Os modelos prontos podem ser copiados e editados.</p>
        </div>
        <div className="btn-group">
          <select className="input ai-inline-select" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filtrar prompts por tipo">
            <option value="">Todos os tipos</option>
            <option value="atendimento">Atendimento</option>
            <option value="marketing">Marketing</option>
          </select>
          <button type="button" className="btn btn-primary" onClick={() => setForm({ ...EMPTY })}><Icon name="plus" size={18} /> Novo prompt</button>
        </div>
      </header>

      {form && (
        <form className="ai-prompt-form" onSubmit={save}>
          <div className="form-row">
            <label className="field"><span>Nome do prompt</span><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required minLength={2} maxLength={80} placeholder="Ex.: Atendimento da loja de roupas" /></label>
            <label className="field"><span>Marcar como</span>
              <select className="input" value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value })}>
                <option value="atendimento">Atendimento (responde mensagens)</option>
                <option value="marketing">Marketing (envia mensagens)</option>
              </select>
            </label>
          </div>
          <label className="field"><span>Conteúdo</span>
            <textarea className="input ai-prompt ai-prompt-tall" value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} required minLength={20} maxLength={12000} />
            <small>{form.content.length.toLocaleString('pt-BR')} / 12.000 caracteres. Descreva o papel, regras, tom de voz e o que fazer com imagens, áudios e arquivos.</small>
          </label>
          <div className="ai-editor-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setForm(null)} disabled={saving}>Cancelar</button>
            <button className="btn btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar prompt'}</button>
          </div>
        </form>
      )}

      <h3>Meus prompts</h3>
      <div className="ai-prompt-grid">
        {prompts.filter(match).map((prompt) => (
          <article className="ai-prompt-card" key={prompt.id}>
            <span className={`ai-mode ${prompt.mode}`}>{MODE_LABEL[prompt.mode]}</span>
            <h4>{prompt.name}</h4>
            <p className="muted small">{prompt.content.slice(0, 180)}{prompt.content.length > 180 ? '…' : ''}</p>
            <div className="ai-agent-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ ...prompt })}><Icon name="edit" size={16} /> Editar</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm({ ...EMPTY, name: `${prompt.name} (cópia)`, mode: prompt.mode, content: prompt.content })}><Icon name="copy" size={16} /> Duplicar</button>
              <button type="button" className="btn btn-ghost btn-sm icon-btn-danger" onClick={() => remove(prompt)}><Icon name="trash" size={16} /> Excluir</button>
            </div>
          </article>
        ))}
        {!prompts.filter(match).length && <p className="muted">Você ainda não criou prompts{filter ? ' deste tipo' : ''}. Use “Novo prompt” ou copie um modelo pronto abaixo.</p>}
      </div>

      <h3>Modelos prontos</h3>
      <div className="ai-prompt-grid">
        {builtin.filter(match).map((prompt) => (
          <article className="ai-prompt-card is-builtin" key={prompt.id}>
            <span className={`ai-mode ${prompt.mode}`}>{MODE_LABEL[prompt.mode]}</span>
            <h4>{prompt.name}</h4>
            <details>
              <summary>Ver conteúdo</summary>
              <pre className="ai-prompt-preview">{prompt.content}</pre>
            </details>
            <div className="ai-agent-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { setForm({ ...EMPTY, name: prompt.name, mode: prompt.mode, content: prompt.content }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Copiar e editar</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
