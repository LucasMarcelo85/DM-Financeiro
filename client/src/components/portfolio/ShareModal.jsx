import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon.jsx';
import Modal from '../Modal.jsx';
import { useToast } from '../Toast.jsx';
import { pageUrl } from '../../lib/portfolio/model.js';
import { canNativeShare, copyText, emailShareUrl, whatsappShareUrl } from '../../lib/portfolio/share.js';

// Link da página para copiar e enviar. Se a página ainda é rascunho, avisa e oferece publicar.
export default function ShareModal({ name, path, customUrl, published, busy, onPublish, onClose }) {
  const toast = useToast();
  const url = pageUrl(path, customUrl);
  const input = useRef(null);
  const timer = useRef(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    if (await copyText(url)) {
      setCopied(true);
      toast('Link copiado!');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2500);
    } else {
      input.current?.focus();
      input.current?.select();
      toast('Não consegui copiar sozinho. O link está selecionado: use Ctrl+C.', 'error');
    }
  }

  async function nativeShare() {
    try { await navigator.share({ title: name, text: name, url }); } catch { /* a pessoa cancelou */ }
  }

  return (
    <Modal title="Compartilhar página" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Pronto</button>}>
      {!published && (
        <div className="banner banner-amber pl-draft">
          <div>
            <strong>Esta página ainda é um rascunho.</strong>
            <span>Só você consegue ver. Publique para o link funcionar para os outros.</span>
          </div>
          <button className="btn btn-primary btn-sm" onClick={onPublish} disabled={busy}>{busy ? 'Publicando...' : 'Publicar agora'}</button>
        </div>
      )}

      <label className="field">
        <span>Link da página</span>
        <div className="pl-share-url">
          <input ref={input} className="input" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Link da página" />
          <button className="btn btn-primary" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={18} /> {copied ? 'Copiado!' : 'Copiar link'}</button>
        </div>
      </label>

      <div className="pl-share-btns">
        <a className="btn btn-ghost btn-sm" href={whatsappShareUrl(name, url)} target="_blank" rel="noopener noreferrer"><Icon name="chat" size={16} /> Enviar por WhatsApp</a>
        <a className="btn btn-ghost btn-sm" href={emailShareUrl(name, url)}><Icon name="send" size={16} /> Enviar por e-mail</a>
        {canNativeShare() && <button className="btn btn-ghost btn-sm" onClick={nativeShare}><Icon name="share" size={16} /> Mais opções</button>}
        {published && <a className="btn btn-ghost btn-sm" href={url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={16} /> Abrir página</a>}
      </div>
      <p className="muted small">O link mostra o título, a descrição e a imagem da página quando enviado pelo WhatsApp e redes sociais (veja em "Ao enviar o link" no editor).</p>
    </Modal>
  );
}
