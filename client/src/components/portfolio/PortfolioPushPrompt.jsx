import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';

function applicationKey(value) {
  const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`;
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export default function PortfolioPushPrompt({ slug, page }) {
  const [status, setStatus] = useState('loading');
  const [publicKey, setPublicKey] = useState('');
  const [message, setMessage] = useState('');
  const registration = useRef(null);
  const pageQuery = new URLSearchParams({ u: slug });
  if (!page.isMain) pageQuery.set('p', page.slug);
  const subscriptionUrl = `/public/portfolio/push-subscription?${pageQuery}`;

  useEffect(() => {
    let active = true;
    async function prepare() {
      if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setStatus('unsupported');
        return;
      }
      try {
        const config = await api.get('/public/portfolio/push-config');
        if (!active) return;
        if (!config.publicKey) {
          setStatus('unavailable');
          return;
        }
        setPublicKey(config.publicKey);
        await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
        const ready = await navigator.serviceWorker.ready;
        registration.current = ready;
        const subscription = await ready.pushManager.getSubscription();
        if (subscription) await api.post(subscriptionUrl, { subscription: subscription.toJSON() });
        if (active) setStatus(subscription ? 'subscribed' : Notification.permission === 'denied' ? 'denied' : 'ready');
      } catch (error) {
        if (active) {
          setMessage(error.message || 'Não foi possível preparar as notificações.');
          setStatus('error');
        }
      }
    }
    prepare();
    return () => { active = false; };
  }, [subscriptionUrl]);

  async function toggle() {
    setMessage('');
    setStatus('busy');
    try {
      const currentRegistration = registration.current || await navigator.serviceWorker.ready;
      const currentSubscription = await currentRegistration.pushManager.getSubscription();
      if (currentSubscription) {
        await api.del(subscriptionUrl, { endpoint: currentSubscription.endpoint });
        await currentSubscription.unsubscribe();
        setStatus('ready');
        setMessage('Notificações desativadas neste aparelho.');
        return;
      }
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'ready');
        setMessage(permission === 'denied'
          ? 'A permissão foi bloqueada. Altere-a nas configurações do navegador.'
          : 'Permita as notificações para receber novos avisos.');
        return;
      }
      const subscription = await currentRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationKey(publicKey),
      });
      await api.post(subscriptionUrl, { subscription: subscription.toJSON() });
      setStatus('subscribed');
      setMessage('Este aparelho receberá notificações de novos avisos.');
    } catch (error) {
      setStatus('error');
      setMessage(error.message || 'Não foi possível atualizar as notificações.');
    }
  }

  if (['loading', 'unavailable', 'unsupported'].includes(status)) return null;
  if (status === 'error') {
    return <aside className="pv-push-prompt" role="status">{message}</aside>;
  }
  const subscribed = status === 'subscribed';
  const blocked = status === 'denied';
  return (
    <aside className="pv-push-prompt" aria-label="Notificações de avisos">
      <span>{blocked
        ? 'Notificações bloqueadas. Altere a permissão nas configurações do navegador.'
        : subscribed ? 'Avisos ativados neste aparelho.' : 'Receba uma notificação quando houver novos avisos.'}</span>
      {!blocked && (
        <button type="button" className="pv-push-button" onClick={toggle} disabled={status === 'busy'}>
          {status === 'busy' ? 'Aguarde...' : subscribed ? 'Desativar' : 'Ativar notificações'}
        </button>
      )}
      {message && <small role="status">{message}</small>}
    </aside>
  );
}
