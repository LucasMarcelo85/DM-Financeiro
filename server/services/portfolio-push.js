import { sendNotification, setVapidDetails } from 'web-push';
import { config } from '../config.js';
import { prisma } from '../prisma.js';

const vapidSubject = (value) => (/^[^\s@:/]+@[^\s@]+\.[^\s@]+$/.test(value) ? `mailto:${value}` : value);
let ready = Boolean(config.webPush.publicKey && config.webPush.privateKey && config.webPush.subject);
if (ready) {
  try {
    setVapidDetails(vapidSubject(config.webPush.subject), config.webPush.publicKey, config.webPush.privateKey);
  } catch (error) {
    ready = false;
    console.warn(`[push] notificações do portfólio desativadas: configuração VAPID inválida (${error.message}).`);
  }
} else {
  console.warn('[push] notificações do portfólio desativadas: configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT.');
}

export const vapidPublicKey = () => (ready ? config.webPush.publicKey : '');

export async function notifyPortfolioNotice({ portfolioId, notice, siteName, iconUrl }) {
  if (!ready) return { configured: false, subscribers: 0, sent: 0, failed: 0 };

  const subscriptions = await prisma.portfolioPushSubscription.findMany({
    where: { portfolioId },
    select: { endpoint: true, subscription: true, url: true },
  });
  let sent = 0;
  let failed = 0;
  const title = notice.title || siteName || 'Novo aviso';
  const body = notice.message || (notice.title ? siteName : '') || 'Há um novo aviso no site.';

  for (let offset = 0; offset < subscriptions.length; offset += 25) {
    const batch = subscriptions.slice(offset, offset + 25);
    await Promise.all(batch.map(async (subscription) => {
      try {
        await sendNotification(subscription.subscription, JSON.stringify({
          title,
          body,
          url: subscription.url,
          icon: iconUrl,
          tag: `portfolio-${portfolioId}-${notice.id}`,
        }), { TTL: 60 });
        sent += 1;
      } catch (error) {
        failed += 1;
        if (error.statusCode === 404 || error.statusCode === 410) {
          await prisma.portfolioPushSubscription.deleteMany({
            where: { portfolioId, endpoint: subscription.endpoint },
          }).catch((cleanupError) => {
            console.error('[push] não removeu uma inscrição expirada:', cleanupError.message);
          });
        }
        console.warn('[push] falha ao enviar aviso', {
          portfolioId, statusCode: error.statusCode || null, message: error.message,
        });
      }
    }));
  }
  return { configured: true, subscribers: subscriptions.length, sent, failed };
}
