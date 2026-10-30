import { useEffect, useRef, useState } from 'react';
import EIcon from '../contract/EIcon.jsx';
import { fitImage, IMAGE_ACCEPT } from '../../lib/contract/image.js';
import { formatStoredPhone, maskPhone } from '../../lib/format.js';
import { linkHref } from '../../lib/portfolio/model.js';

// Campos do painel de propriedades do portfólio (mesmo visual do editor de contratos: classes ce-*).
const HEX = /^#[0-9a-f]{6}$/i;

export function Section({ title, children }) {
  return (
    <section className="ce-sec">
      <h3>{title}</h3>
      <div className="ce-sec-body">{children}</div>
    </section>
  );
}

export function TextField({ label, value, onChange, placeholder, maxLength, id, multiline, rows = 3, type = 'text', hint }) {
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <label className="ce-field">
      <span>{label}</span>
      <Tag className={multiline ? 'input' : 'input input-sm'} {...(multiline ? { rows } : { type })} value={value ?? ''} maxLength={maxLength} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value, `txt:${id || label}`)} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

// Escolha entre poucas opções ([valor, rótulo]).
export function Seg({ label, value, options, onChange, id }) {
  return (
    <div className="ce-field">
      <span>{label}</span>
      <div className="seg pe-seg" style={{ '--n': options.length }} role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={value === v ? 'is-on' : ''} onClick={() => onChange(v, `seg:${id || label}`)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

export function Check({ label, checked, onChange }) {
  return (
    <label className="pe-check">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function RangeField({ label, value, onChange, min, max, step = 1, suffix = '', id, format }) {
  return (
    <label className="ce-field">
      <span>{label}</span>
      <span className="ce-num">
        <input type="range" className="pe-range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value), `rng:${id || label}`)} aria-label={label} />
        <em>{format ? format(value) : `${value}${suffix}`}</em>
      </span>
    </label>
  );
}

export function ColorField({ label, value, onChange, allowNone, id }) {
  const none = allowNone && !value;
  const [text, setText] = useState(value || '');
  useEffect(() => setText(value || ''), [value]);
  const key = `color:${id || label}`;
  return (
    <div className="ce-field">
      <span>{label}</span>
      <span className="ce-color">
        <input type="color" value={HEX.test(value || '') ? value : '#ffffff'} onChange={(e) => onChange(e.target.value, key)} aria-label={label} />
        <input
          className="input input-sm"
          value={none ? '' : text}
          placeholder={allowNone ? 'cor do tema' : '#000000'}
          maxLength={7}
          onChange={(e) => { setText(e.target.value); if (HEX.test(e.target.value)) onChange(e.target.value.toLowerCase(), key); }}
          onBlur={() => setText(value || '')}
          aria-label={`${label} (código)`}
        />
        {allowNone && <button type="button" className={`ce-mini ${none ? 'is-on' : ''}`} onClick={() => onChange('', key)} title="Usar a cor do tema" aria-label="Usar a cor do tema"><EIcon name="x" size={14} /></button>}
      </span>
    </div>
  );
}

// Uma imagem (banner, logo, foto): escolhe o arquivo, reduz no navegador e guarda dentro da página.
export function ImageField({ label, value, onChange, maxDim = 1600, onError }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);

  async function pick(file) {
    if (!file) return;
    setBusy(true);
    try { onChange((await fitImage(file, maxDim)).src); } catch (e) { onError?.(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="ce-field">
      <span>{label}</span>
      <div className="pe-img">
        <span className="pe-img-thumb">{value ? <img src={value} alt="" /> : <EIcon name="image" size={22} />}</span>
        <div className="pe-img-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => input.current?.click()} disabled={busy}>{busy ? 'Enviando...' : value ? 'Trocar imagem' : 'Escolher imagem'}</button>
          {value && <button type="button" className="link-btn" onClick={() => onChange('')}>Remover</button>}
        </div>
      </div>
      <input ref={input} type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; pick(f); }} />
    </div>
  );
}

// Várias imagens de uma vez (galeria).
export function GalleryField({ items, max, onAdd, onRemove, onError }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const room = max - items.length;

  async function pick(files) {
    const list = [...files].slice(0, Math.max(0, room));
    if (!list.length) return;
    setBusy(true);
    const added = [];
    try {
      for (const f of list) added.push((await fitImage(f, 1400)).src); // uma por vez: não pesa na memória do celular
    } catch (e) { onError?.(e.message); } finally {
      setBusy(false);
      if (added.length) onAdd(added);
    }
    if (files.length > list.length) onError?.(`A galeria aceita até ${max} imagens.`);
  }

  return (
    <div className="ce-field">
      <span>Imagens ({items.length}/{max})</span>
      {items.length > 0 && (
        <ul className="pe-gal">
          {items.map((it) => (
            <li key={it.id}>
              <img src={it.src} alt="" />
              <button type="button" onClick={() => onRemove(it.id)} aria-label="Remover imagem" title="Remover"><EIcon name="x" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => input.current?.click()} disabled={busy || room <= 0}>
        <EIcon name="plus" size={16} /> {busy ? 'Enviando...' : room <= 0 ? 'Limite de imagens' : 'Adicionar imagens'}
      </button>
      <input ref={input} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={(e) => { const f = e.target.files; const arr = f ? [...f] : []; e.target.value = ''; pick(arr); }} />
    </div>
  );
}

// Para onde o botão leva: site, WhatsApp, telefone ou e-mail.
const KINDS = [['link', 'Site, Instagram ou outro link'], ['whatsapp', 'WhatsApp'], ['tel', 'Ligação'], ['email', 'E-mail']];

export function LinkFields({ link, onChange, id }) {
  const set = (patch, key) => onChange({ ...link, ...patch }, key || `link:${id}`);
  const ok = Boolean(linkHref(link));
  return (
    <div className="pe-link">
      <label className="ce-field">
        <span>Ao clicar, abrir</span>
        <select className="input input-sm" value={link.kind} onChange={(e) => set({ kind: e.target.value }, `link-kind:${id}`)}>
          {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      {link.kind === 'link' && <TextField label="Endereço do site ou perfil" value={link.url} placeholder="https://instagram.com/seuperfil" maxLength={2000} id={`${id}-url`} onChange={(v, k) => set({ url: v }, k)} />}
      {(link.kind === 'whatsapp' || link.kind === 'tel') && (
        <label className="ce-field">
          <span>{link.kind === 'whatsapp' ? 'Número do WhatsApp' : 'Telefone'}</span>
          <input className="input input-sm" inputMode="tel" value={formatStoredPhone(link.phone)} placeholder="(85) 99999-9999" onChange={(e) => set({ phone: maskPhone(e.target.value) }, `phone:${id}`)} />
        </label>
      )}
      {link.kind === 'whatsapp' && <TextField label="Mensagem pronta (opcional)" multiline rows={2} value={link.message} maxLength={500} id={`${id}-msg`} placeholder="Olá! Vim pela sua página." onChange={(v, k) => set({ message: v }, k)} />}
      {link.kind === 'email' && <TextField label="E-mail" type="email" value={link.email} placeholder="contato@suaempresa.com.br" maxLength={254} id={`${id}-mail`} onChange={(v, k) => set({ email: v }, k)} />}
      <p className={`pe-hint ${ok ? 'is-ok' : 'is-warn'}`}>{ok ? 'Link pronto.' : 'Preencha o link para o botão aparecer na página publicada.'}</p>
    </div>
  );
}
