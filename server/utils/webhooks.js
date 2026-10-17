import { config } from '../config.js';
import { hmac } from './secret.js';

// Endereços que o sistema entrega para a Evolution e para a Meta chamarem (webhooks).
export const evolutionWebhookUrl = (name) => `${config.appUrl}/api/webhooks/evolution/${encodeURIComponent(name)}?token=${hmac('evo-webhook', name)}`;
export const evolutionTokenFor = (name) => hmac('evo-webhook', name);
export const metaWebhookUrl = () => `${config.appUrl}/api/webhooks/meta`;
// localhost não é alcançável pela Evolution/Meta: só funciona com o sistema publicado.
export const appUrlIsPublic = () => /^https?:\/\//.test(config.appUrl) && !/\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(config.appUrl);
