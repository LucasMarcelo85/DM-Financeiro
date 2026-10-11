import { Router } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { AppError, normalizePhone, sleep } from '../utils/helpers.js';
import * as evo from '../services/evolution.js';

const router = Router();
const KINDS = ['cobranca', 'lembrete'];
const LABEL = { cobranca: 'cobrança', lembrete: 'lembrete' };

router.post('/', async (req, res) => {
  const b = req.body || {};
  const kind = b.kind;
  const text = String(b.text || '').trim();
  const extra = String(b.extra || '').trim();
  const number = normalizePhone(b.number);

  if (!KINDS.includes(kind)) throw new AppError(400, 'Tipo de mensagem inválido.');
  if (!number) throw new AppError(400, 'Número inválido. Use DDD + número, por exemplo (85) 99999-9999.');
  if (!text) throw new AppError(400, 'Escreva o texto da mensagem.');
  if (text.length > 4000) throw new AppError(400, 'O texto é muito longo (máximo de 4.000 caracteres).');
  if (extra.length > 1000) throw new AppError(400, 'O link ou chave Pix é muito longo.');

  const inst = db.prepare('SELECT * FROM instances WHERE id = ? AND user_id = ?').get(Number(b.instanceId), req.user.id);
  if (!inst) throw new AppError(400, 'Escolha um WhatsApp conectado para enviar.');

  const state = await evo.getState(inst.name);
  if (state !== 'open') {
    throw new AppError(409, 'Este WhatsApp está desconectado. Conecte lendo o QR Code e tente de novo.', 'WHATSAPP_DISCONNECTED');
  }

  const log = (status, error) =>
    db
      .prepare('INSERT INTO messages (user_id, instance_name, kind, number, has_extra, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(req.user.id, inst.name, kind, number, extra ? 1 : 0, status, error || null, Date.now());

  try {
    await evo.sendText(inst.name, number, text);
  } catch (e) {
    log('failed', e.message);
    throw e;
  }

  if (extra) {
    try {
      await sleep(config.evolution.messageDelayMs);
      await evo.sendText(inst.name, number, extra);
    } catch (e) {
      log('partial', e.message);
      throw new AppError(502, `O texto foi enviado, mas o link/Pix não. ${e.message}`, 'PARTIAL_SEND');
    }
  }

  log('sent');
  res.json({ status: 'sent', message: `Enviamos ${extra ? 'a ' + LABEL[kind] + ' em 2 mensagens' : 'a ' + LABEL[kind]}.` });
});

router.get('/', (req, res) => {
  const kind = KINDS.includes(req.query.kind) ? req.query.kind : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const rows = db
    .prepare(
      `SELECT id, kind, number, has_extra AS hasExtra, status, created_at AS createdAt
       FROM messages WHERE user_id = ? ${kind ? 'AND kind = ?' : ''} ORDER BY id DESC LIMIT ?`
    )
    .all(...(kind ? [req.user.id, kind, limit] : [req.user.id, limit]));
  res.json({ messages: rows.map((r) => ({ ...r, hasExtra: Boolean(r.hasExtra) })) });
});

export default router;
