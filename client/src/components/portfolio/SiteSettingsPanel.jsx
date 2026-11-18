import { useRef, useState } from 'react';
import { prepareProductImage } from '../../lib/portfolio/imageTools.js';
import { useToast } from '../Toast.jsx';
import { Check } from './Fields.jsx';

const newNoticeId = () => `notice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function squareLogos(file) {
  if (file.size > 15 * 1024 * 1024) throw new Error('A logo é muito grande. Escolha um arquivo de até 15 MB.');
  const { src } = await prepareProductImage(file, { maxDim: 512, maxBytes: 500 * 1024 });
  const image = new Image();
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Não foi possível preparar a logo para instalação.'));
  });
  image.src = src;
  await loaded;
  const square = (size) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível preparar a logo para instalação.');
    const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
    return canvas.toDataURL('image/png');
  };
  return { logo: square(512), logo192: square(192) };
}

// Nome, logo (ícone da aba e do aplicativo) e liberação da instalação. Usado no canvas, na aba "Logo e avisos" e no modal de entrega e frete.
export function SiteIdentityFields({ branding = {}, onChange }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function pickLogo(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'].includes(file.type)
      && !/\.(png|jpe?g|webp|heic|heif)$/i.test(file.name || '')) {
      toast('Use uma logo PNG, JPG, WebP ou HEIC/HEIF.', 'error');
      return;
    }
    setBusy(true);
    try {
      const logos = await squareLogos(file);
      onChange({ ...branding, ...logos }, 'branding:logo');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label className="field">
        <span>Nome exibido no site</span>
        <input className="input" value={branding.siteName || ''} maxLength={80}
          onChange={(event) => onChange({ ...branding, siteName: event.target.value }, 'branding:name')}
          placeholder="Nome da sua loja ou negócio" />
        <small>Este nome aparece no título da aba e no lugar do nome do administrador.</small>
      </label>

      <section className="site-logo">
        <div>
          <strong>Logo do site e do aplicativo</strong>
          <p className="muted small">A imagem será usada como ícone da aba, na instalação do app e no arquivo manifest.</p>
        </div>
        {branding.logo
          ? <img src={branding.logo} alt="Prévia da logo" />
          : <span className="site-logo-empty">Sem logo</span>}
        <div className="btn-group">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif" hidden onChange={pickLogo} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? 'Preparando...' : branding.logo ? 'Trocar logo' : 'Adicionar logo'}
          </button>
          {branding.logo && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ ...branding, logo: '', logo192: '' }, 'branding:logo')}>Remover</button>}
        </div>
      </section>

      <section className="site-app-info">
        <strong>Instalação do aplicativo</strong>
        <p className="muted small">
          Quando permitido, aparece no site um botão para o cliente instalar o site como aplicativo. A página precisa estar publicada em HTTPS.
        </p>
        <Check
          label="Mostrar aos clientes o botão para instalar o site como aplicativo"
          checked={branding.installEnabled !== false}
          onChange={(installEnabled) => onChange({ ...branding, installEnabled }, 'branding:install')}
        />
      </section>
    </>
  );
}

export default function SiteSettingsPanel({ branding = {}, onChange }) {
  const notices = Array.isArray(branding.notices) ? branding.notices : [];

  function updateNotice(id, patch) {
    onChange({
      ...branding,
      notices: notices.map((notice) => (notice.id === id ? { ...notice, ...patch } : notice)),
    }, `notice:${id}`);
  }

  return (
    <div className="site-settings">
      <p className="muted small">Edite nome, logo, avisos e identidade do app aqui mesmo no editor. Depois, clique em <strong>Salvar</strong> na barra superior.</p>
      <SiteIdentityFields branding={branding} onChange={onChange} />

        <section className="site-notices">
          <div className="site-settings-heading">
            <div>
              <strong>Avisos exibidos no site</strong>
              <p className="muted small">Os avisos aparecem em um modal central sobre o site; o visitante pode fechá-lo no ×. Salve a página para aplicar.</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" disabled={notices.length >= 10}
              onClick={() => onChange({ ...branding, notices: [...notices, { id: newNoticeId(), title: '', message: '' }] }, 'branding:notices')}>
              Adicionar aviso
            </button>
          </div>
          {notices.map((notice, index) => (
            <fieldset className="site-notice" key={notice.id}>
              <legend>Aviso {index + 1}</legend>
              <label className="field">
                <span>Título</span>
                <input className="input" value={notice.title || ''} maxLength={80}
                  onChange={(event) => updateNotice(notice.id, { title: event.target.value })} />
              </label>
              <label className="field">
                <span>Mensagem</span>
                <textarea className="input" value={notice.message || ''} maxLength={500} rows={3}
                  onChange={(event) => updateNotice(notice.id, { message: event.target.value })} />
              </label>
              <button type="button" className="link-btn" onClick={() => onChange({
                ...branding, notices: notices.filter((item) => item.id !== notice.id),
              }, 'branding:notices')}>Remover aviso</button>
            </fieldset>
          ))}
          {!notices.length && <p className="muted small">Nenhum aviso cadastrado.</p>}
        </section>
    </div>
  );
}
