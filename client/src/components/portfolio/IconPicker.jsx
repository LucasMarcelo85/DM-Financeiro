import { useMemo, useState } from 'react';
import Modal from '../Modal.jsx';
import { IconSvg } from './Canvas.jsx';
import { ICONS } from '../../lib/portfolio/icons.js';

const GROUPS = [['social', 'Redes sociais'], ['contact', 'Contato'], ['shop', 'Comércio'], ['general', 'Geral']];

// Escolha de ícone: botão que mostra o atual e abre a lista (com busca) das redes sociais e ícones gerais.
export default function IconPicker({ value, onChange, label = 'Ícone', allowNone }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return Object.entries(ICONS).filter(([k, v]) => !t || k.includes(t) || v.label.toLowerCase().includes(t));
  }, [q]);

  return (
    <div className="ce-field">
      <span>{label}</span>
      <div className="pe-icon-pick">
        <button type="button" className="btn btn-ghost btn-sm pe-icon-btn" onClick={() => setOpen(true)}>
          {value ? <IconSvg name={value} size={20} /> : <span className="muted">—</span>}
          <span>{value ? (ICONS[value]?.label || value) : 'Sem ícone'}</span>
        </button>
        {allowNone && value && <button type="button" className="link-btn" onClick={() => onChange('')}>Remover</button>}
      </div>
      {open && (
        <Modal title="Escolher ícone" onClose={() => setOpen(false)}>
          <input className="input input-sm" type="search" placeholder="Buscar (ex.: whatsapp, carrinho)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Buscar ícone" />
          <div className="pe-icon-groups">
            {GROUPS.map(([g, title]) => {
              const items = list.filter(([, v]) => v.g === g);
              if (!items.length) return null;
              return (
                <section key={g}>
                  <h4>{title}</h4>
                  <div className="pe-icon-grid">
                    {items.map(([k, v]) => (
                      <button key={k} type="button" className={`pe-icon-cell${value === k ? ' is-on' : ''}`} title={v.label} onClick={() => { onChange(k); setOpen(false); }}>
                        <IconSvg name={k} size={26} />
                        <small>{v.label}</small>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
            {!list.length && <p className="muted">Nenhum ícone encontrado.</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
