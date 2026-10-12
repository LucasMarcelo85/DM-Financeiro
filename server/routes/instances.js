import { Router } from 'express';
import { prisma } from '../prisma.js';
import { evolutionConfigured } from '../config.js';
import { AppError } from '../utils/helpers.js';
import { limitsFor } from '../plans.js';
import * as evo from '../services/evolution.js';

const router = Router();

async function ownInstance(req) {
  const id = Number(req.params.id);
  const inst = Number.isInteger(id) ? await prisma.instance.findFirst({ where: { id, userId: req.user.id } }) : null;
  if (!inst) throw new AppError(404, 'WhatsApp não encontrado.');
  return inst;
}

// O nome da instância é o CPF/CNPJ do usuário (a 2ª e 3ª ganham sufixo -2, -3).
async function nextInstanceName(user) {
  const base = (user.document || 'admin').replace(/[^a-zA-Z0-9]/g, '') || 'admin';
  const taken = new Set((await prisma.instance.findMany({ where: { userId: user.id }, select: { name: true } })).map((r) => r.name));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  return name;
}

router.get('/', async (req, res) => {
  const rows = await prisma.instance.findMany({ where: { userId: req.user.id }, orderBy: { id: 'asc' }, select: { id: true, name: true } });
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

  res.json({ instances, limit: limitsFor(req.user).instances, evolutionConfigured: configured, unreachable: failed });
});

router.post('/', async (req, res) => {
  const limit = limitsFor(req.user).instances;
  const count = await prisma.instance.count({ where: { userId: req.user.id } });
  if (count >= limit) {
    throw new AppError(403, `Seu plano permite ${limit} ${limit === 1 ? 'WhatsApp conectado' : 'WhatsApps conectados'}. Mude de plano para adicionar mais.`, 'LIMIT_REACHED');
  }

  const name = await nextInstanceName(req.user);
  let data;
  try {
    data = await evo.createInstance(name);
  } catch (e) {
    // Instância já existe na Evolution (ex.: criada antes): só pede o QR de novo.
    if (e.upstreamStatus === 403 || e.upstreamStatus === 409) data = await evo.connectInstance(name);
    else throw e;
  }

  const instance = await prisma.instance.create({ data: { userId: req.user.id, name }, select: { id: true, name: true } });
  res.status(201).json({ instance, connected: false, ...evo.normalizeQr(data) });
});

router.post('/:id/connect', async (req, res) => {
  const inst = await ownInstance(req);
  const state = await evo.getState(inst.name);
  if (state === 'open') return res.json({ connected: true, qr: null, pairingCode: null });

  const data = state === 'missing' ? await evo.createInstance(inst.name) : await evo.connectInstance(inst.name);
  res.json({ connected: false, ...evo.normalizeQr(data) });
});

router.post('/:id/logout', async (req, res) => {
  const inst = await ownInstance(req);
  try {
    await evo.logoutInstance(inst.name);
  } catch (e) {
    if (e.upstreamStatus !== 404 && e.upstreamStatus !== 400) throw e;
  }
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const inst = await ownInstance(req);
  await evo.deleteInstance(inst.name);
  await prisma.instance.delete({ where: { id: inst.id } });
  res.json({ ok: true });
});

export default router;
