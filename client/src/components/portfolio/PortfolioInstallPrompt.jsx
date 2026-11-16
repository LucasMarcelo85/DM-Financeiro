import { useEffect, useState } from 'react';

export default function PortfolioInstallPrompt({ enabled }) {
  const [installEvent, setInstallEvent] = useState(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!enabled) return undefined;
    const onBeforeInstall = (event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    if (window.matchMedia?.('(display-mode: standalone)').matches) setInstalled(true);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
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
      setInstallEvent(null);
      if (choice.outcome === 'accepted') setInstalled(true);
      else setMessage('A instalação não foi concluída.');
    } catch (error) {
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
