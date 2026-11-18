import { useEffect, useState } from 'react';

export default function PortfolioInstallPrompt({ enabled, installEvent, onInstallEventConsumed }) {
  const [showInstructions, setShowInstructions] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const onInstalled = () => {
      setInstalled(true);
      onInstallEventConsumed?.();
    };
    if (window.matchMedia?.('(display-mode: standalone)').matches) setInstalled(true);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [onInstallEventConsumed]);

  useEffect(() => {
    if (!enabled || !window.isSecureContext || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {});
  }, [enabled]);

  async function install() {
    setMessage('');
    if (!installEvent) {
      setShowInstructions((current) => !current);
      return;
    }
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      onInstallEventConsumed?.();
      if (choice.outcome === 'accepted') setInstalled(true);
      else setMessage('A instalação não foi concluída.');
    } catch (error) {
      onInstallEventConsumed?.();
      setMessage(error.message || 'Não foi possível iniciar a instalação neste navegador.');
    }
  }

  if (!enabled || installed) return null;
  return (
    <aside className="pv-install-prompt" aria-label="Instalar site como aplicativo">
      <span>Use este site como um aplicativo no seu dispositivo.</span>
      <button type="button" className="pv-push-button" onClick={install}>
        {installEvent ? 'Instalar aplicativo' : 'Como instalar'}
      </button>
      {showInstructions && !installEvent && (
        <small>Abra o menu do navegador e escolha “Instalar app” ou “Adicionar à tela inicial”. No iPhone ou iPad, use Compartilhar e “Adicionar à Tela de Início”.</small>
      )}
      {message && <small role="status">{message}</small>}
    </aside>
  );
}
