import express, { Router } from 'express';
import { prisma } from '../prisma.js';
import { decrypt, safeEqual } from '../utils/secret.js';
import { evolutionTokenFor } from '../utils/webhooks.js';
import * as meta from '../services/meta.js';
import { ingestEvolution, ingestMeta } from '../services/audit.js';

// Recebe as mensagens da Evolution (QR Code) e da Meta (API oficial). Sempre responde 200 depois de validar
// quem chamou, para o servidor de origem não ficar reenviando; erros internos só vão para o log.
const router = Router();

router.post('/evolution/:name', express.json({ limit: '3mb' }), async (req, res) => {
  const { name } = req.params;
  if (!safeEqual(req.query.token, evolutionTokenFor(name))) return res.status(401).json({ error: 'Token inválido.' });
  try {
    const inst = await prisma.instance.findUnique({ where: { name }, include: { user: true } });
    if (inst && inst.purpose === 'auditoria' && inst.provider === 'evolution') await ingestEvolution(inst, req.body?.event, req.body?.data);
  } catch (e) {
    console.error(`[auditoria] erro ao receber evento de ${name}:`, e);
  }
  return res.json({ ok: true });
});

// A Meta confirma o endereço do webhook com um GET (hub.challenge).
router.get('/meta', async (req, res) => {
  const token = String(req.query['hub.verify_token'] || '');
  if (req.query['hub.mode'] === 'subscribe' && token && (await prisma.instance.findFirst({ where: { provider: 'meta', metaVerifyToken: token }, select: { id: true } }))) {
    return res.status(200).type('text/plain').send(String(req.query['hub.challenge'] || ''));
  }
  return res.status(403).send('Forbidden');
});

router.post('/meta', async (req, res) => {
  try {
    const events = meta.parseWebhook(req.body);
    for (const ev of events) {
      const insts = await prisma.instance.findMany({ where: { provider: 'meta', purpose: 'auditoria', metaPhoneNumberId: ev.phoneNumberId }, include: { user: true } });
      for (const inst of insts) {
        // O App Secret assina cada webhook: sem assinatura válida a mensagem é ignorada.
        if (!meta.verifySignature(req.rawBody, req.get('x-hub-signature-256'), decrypt(inst.metaAppSecret))) continue;
        await ingestMeta(inst, ev);
      }
    }
  } catch (e) {
    console.error('[auditoria] erro ao receber evento da Meta:', e);
  }
  return res.json({ ok: true });
});

export default router;
