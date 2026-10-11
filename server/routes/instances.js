import { Router } from 'express';
import { db } from '../db.js';
import { evolutionConfigured } from '../config.js';
import { AppError } from '../utils/helpers.js';
import { limitsFor } from '../plans.js';
import * as evo from '../services/evolution.js';

const router = Router();

function ownInstance(req) {
  const inst = db.prepare('SELECT * FROM instances WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!inst) throw new AppError(404, 'WhatsApp não encontrado.');
  return inst;
}

// O nome da instância é o CPF/CNPJ do usuário (a 2ª e 3ª ganham sufixo -2, -3).
function nextInstanceName(user) {
  const base = (user.document || 'admin').replace(/[^a-zA-Z0-9]/g, '') || 'admin';
  const taken = new Set(db.prepare('SELECT name FROM instances WHERE user_id = ?').all(user.id).map((r) => r.name));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  return name;
}

router.get('/', async (req, res) => {
  const rows = db.prepare('SELECT id, name FROM instances WHERE user_id = ? ORDER BY id').all(req.user.id);
  const configured = evolutionConfigured();
  let failed = false;

  const instances = await Promise.all(
    rows.map(async (r) => {
      if (!configured) return { ...r, state: 'unknown', connected: false };
      try {
        const state = await evo.getState(r.name);
        return { ...r, state, connected: state === 'open' };
      } catch {
        failed = true;
        return { ...r, state: 'unknown', connected: false };
      }
    })
  );

  res.json({
    instances,
    limit: limitsFor(req.user).instances,
    evolutionConfigured: configured,
    unreachable: failed,
  });
});

router.post('/', async (req, res) => {
  const limit = limitsFor(req.user).instances;
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM instances WHERE user_id = ?').get(req.user.id);
  if (c >= limit) {
    throw new AppError(403, `Seu plano permite ${limit} ${limit === 1 ? 'WhatsApp conectado' : 'WhatsApps conectados'}. Mude de plano para adicionar mais.`, 'LIMIT_REACHED');
  }

  const name = nextInstanceName(req.user);
  let data;
  try {
    data = await evo.createInstance(name);
  } catch (e) {
    // Instância já existe na Evolution (ex.: criada antes): só pede o QR de novo.
    if (e.upstreamStatus === 403 || e.upstreamStatus === 409) data = await evo.connectInstance(name);
    else throw e;
  }

  const info = db.prepare('INSERT INTO instances (user_id, name, created_at) VALUES (?, ?, ?)').run(req.user.id, name, Date.now());
  res.status(201).json({ instance: { id: Number(info.lastInsertRowid), name }, connected: false, ...evo.normalizeQr(data) });
});

router.post('/:id/connect', async (req, res) => {
  const inst = ownInstance(req);
  const state = await evo.getState(inst.name);
  if (state === 'open') return res.json({ connected: true, qr: null, pairingCode: null });

  const data = state === 'missing' ? await evo.createInstance(inst.name) : await evo.connectInstance(inst.name);
  res.json({ connected: false, ...evo.normalizeQr(data) });
});

router.post('/:id/logout', async (req, res) => {
  const inst = ownInstance(req);
  try {
    await evo.logoutInstance(inst.name);
  } catch (e) {
    if (e.upstreamStatus !== 404 && e.upstreamStatus !== 400) throw e;
  }
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const inst = ownInstance(req);
  await evo.deleteInstance(inst.name);
  db.prepare('DELETE FROM instances WHERE id = ?').run(inst.id);
  res.json({ ok: true });
});

export default router;
