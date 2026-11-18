import { useEffect, useRef, useState } from 'react';
import PortfolioDialog from './PortfolioDialog.jsx';

function supportsInstallPrompt() {
  const userAgent = navigator.userAgent || '';
  const appleMobile = /iPhone|iPad|iPod/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);
  return !appleMobile && (/Android/i.test(userAgent) || /Windows NT/i.test(userAgent));
}

export default function PortfolioInstallPrompt({ enabled, autoOpen, installEvent, onInstallEventConsumed, theme }) {
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [message, setMessage] = useState('');
  const autoOpened = useRef(false);

  useEffect(() => {
    const onInstalled = () => {
      setInstalled(true);
      setOpen(false);
      onInstallEventConsumed?.();
    };
    if (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone) setInstalled(true);
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, [onInstallEventConsumed]);

  useEffect(() => {
    if (!enabled || !window.isSecureContext || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {});
  }, [enabled]);

  useEffect(() => {
    if (!autoOpen || !enabled || installed || !supportsInstallPrompt() || autoOpened.current) return;
    autoOpened.current = true;
    setOpen(true);
  }, [autoOpen, enabled, installed]);

  async function install() {
    if (!installEvent || busy) return;
    setAttempted(true);
    setBusy(true);
    setMessage('');
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      onInstallEventConsumed?.();
      if (choice.outcome === 'accepted') {
        setInstalled(true);
        setOpen(false);
      } else {
        setMessage('A instalação não foi concluída.');
      }
    } catch (error) {
      onInstallEventConsumed?.();
      setMessage(error.message || 'Não foi possível iniciar a instalação neste navegador.');
    } finally {
      setBusy(false);
    }
  }

  if (!enabled || installed || !supportsInstallPrompt()) return null;
  return (
    open && (
      <PortfolioDialog title="Instalar aplicativo" theme={theme} onClose={() => setOpen(false)}>
        <p>Adicione este site ao seu dispositivo para abri-lo como um aplicativo.</p>
        {installEvent
          ? <button type="button" className="pv-dialog-primary" onClick={install} disabled={busy}>
              {busy ? 'Aguarde...' : 'Instalar agora'}
            </button>
          : !attempted && <div className="pv-install-help">
              <p>A instalação automática não está disponível neste navegador.</p>
              <p><strong>Android:</strong> no Chrome ou Edge, abra o menu e escolha “Instalar app” ou “Adicionar à tela inicial”.</p>
              <p><strong>Windows:</strong> no Chrome ou Edge, use o ícone de instalação na barra de endereço ou o menu do navegador.</p>
            </div>}
        {message && <p className="pv-dialog-message" role="status">{message}</p>}
      </PortfolioDialog>
    )
  );
}
