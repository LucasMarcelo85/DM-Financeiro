import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../prisma.js';
import { evolutionConfigured } from '../config.js';
import { AppError, onlyDigits } from '../utils/helpers.js';
import { limitsFor } from '../plans.js';
import { encrypt } from '../utils/secret.js';
import { appUrlIsPublic, evolutionWebhookUrl, metaWebhookUrl } from '../utils/webhooks.js';
import * as evo from '../services/evolution.js';
import * as meta from '../services/meta.js';
import * as wa from '../services/whatsapp.js';
import { syncInstance, syncState } from '../services/audit.js';

const SELECT = { id: true, name: true, label: true, provider: true, metaPhoneNumberId: true, metaBusinessId: true, metaPhoneDisplay: true, metaVerifyToken: true, metaAccessToken: true, metaAppSecret: true, lastSyncAt: true, lastEventAt: true };

// Nunca devolve o token nem o App Secret: só diz se estão cadastrados.
const publicInstance = (i, extra = {}) => ({
  id: i.id, name: i.name, label: i.label, provider: i.provider,
  lastSyncAt: i.lastSyncAt ? i.lastSyncAt.getTime() : null, lastEventAt: i.lastEventAt ? i.lastEventAt.getTime() : null, sync: syncState(i.id),
  ...(i.provider === 'meta'
    ? { metaPhoneNumberId: i.metaPhoneNumberId, metaBusinessId: i.metaBusinessId, metaPhoneDisplay: i.metaPhoneDisplay, metaVerifyToken: i.metaVerifyToken, hasToken: Boolean(i.metaAccessToken), hasAppSecret: Boolean(i.metaAppSecret) }
    : {}),
  ...extra,
});

function cleanLabel(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s.length > 60) throw new AppError(400, 'O nome da conexão pode ter até 60 caracteres.');
  return s || null;
}

// Valida os campos da API oficial. Em `partial` (edição) só valida o que veio.
function cleanMeta(b, { partial = false } = {}) {
  const out = {};
  if (!partial || b.phoneNumberId !== undefined) {
    const id = onlyDigits(b.phoneNumberId);
    if (!/^\d{5,25}$/.test(id)) throw new AppError(400, 'Informe o Phone Number ID (só números). Ele aparece em WhatsApp > Configuração da API, no painel da Meta.');
    out.phoneNumberId = id;
  }
  if (!partial || b.businessId !== undefined) {
    const id = onlyDigits(b.businessId);
    if (id && !/^\d{5,25}$/.test(id)) throw new AppError(400, 'O ID da conta do WhatsApp Business (WABA) deve ter só números.');
    out.businessId = id || null;
  }
  if (!partial || b.accessToken) {
    const t = String(b.accessToken ?? '').trim();
    if (t.length < 20 || t.length > 1000 || /\s/.test(t)) throw new AppError(400, 'Cole o token de acesso da Meta (sem espaços). Use um token permanente do usuário do sistema.');
    out.accessToken = t;
  }
  if (b.appSecret) {
    const t = String(b.appSecret).trim();
    if (t.length < 16 || t.length > 128 || /\s/.test(t)) throw new AppError(400, 'O App Secret parece inválido. Copie de Configurações do app > Básico, no painel da Meta.');
    out.appSecret = t;
  }
  return out;
}

// `purpose`: 'envio' (cobranças e lembretes) ou 'auditoria' (só leitura das conversas).
export function instanceRouter(purpose) {
  const router = Router();
  const audit = purpose === 'auditoria';
  const limitOf = (user) => limitsFor(user)[audit ? 'auditInstances' : 'instances'];
  const noun = audit ? 'número para auditoria' : 'WhatsApp conectado';
  const nouns = audit ? 'números para auditoria' : 'WhatsApps conectados';

  async function own(req) {
    const id = Number(req.params.id);
    const inst = Number.isInteger(id) ? await prisma.instance.findFirst({ where: { id, userId: req.user.id, purpose } }) : null;
    if (!inst) throw new AppError(404, audit ? 'Número de auditoria não encontrado.' : 'WhatsApp não encontrado.');
    return inst;
  }

  // O nome da conexão é o CPF/CNPJ do usuário (a 2ª e 3ª ganham sufixo -2, -3). Na auditoria: CPF-aud, CPF-aud-2...
  async function nextName(user) {
    const base = `${(user.document || 'admin').replace(/[^a-zA-Z0-9]/g, '') || 'admin'}${audit ? '-aud' : ''}`;
    const taken = new Set((await prisma.instance.findMany({ where: { userId: user.id }, select: { name: true } })).map((r) => r.name));
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
    return name;
  }

  async function assertCanAdd(user) {
    const limit = limitOf(user);
    const count = await prisma.instance.count({ where: { userId: user.id, purpose } });
    if (count >= limit) {
      throw new AppError(403, `Seu plano permite ${limit} ${limit === 1 ? noun : nouns}. Mude de plano para adicionar mais.`, 'LIMIT_REACHED');
    }
  }

  // Na auditoria, a Evolution precisa saber para onde mandar cada mensagem (melhor esforço).
  async function ensureAuditWebhook(name) {
    if (!audit) return;
    try { await evo.setWebhook(name, evolutionWebhookUrl(name)); } catch (e) { console.warn(`[auditoria] webhook de ${name}: ${e.message}`); }
  }

  router.get('/', async (req, res) => {
    const rows = await prisma.instance.findMany({ where: { userId: req.user.id, purpose }, orderBy: { id: 'asc' }, select: SELECT });
    const configured = evolutionConfigured();
    let failed = false;
    const instances = await Promise.all(
      rows.map(async (r) => {
        if (r.provider === 'evolution' && !configured) return publicInstance(r, { state: 'unknown', connected: false });
        try {
          const state = await wa.getState(r);
          return publicInstance(r, { state, connected: state === 'open' });
        } catch {
          failed = true;
          return publicInstance(r, { state: 'unknown', connected: false });
        }
      })
    );
    res.json({
      instances, purpose, limit: limitOf(req.user), evolutionConfigured: configured, unreachable: failed,
      metaWebhookUrl: metaWebhookUrl(), appUrlIsPublic: appUrlIsPublic(),
    });
  });

  router.post('/', async (req, res) => {
    await assertCanAdd(req.user);
    const b = req.body || {};
    const label = cleanLabel(b.label);
    const name = await nextName(req.user);

    if (b.provider === 'meta') {
      const m = cleanMeta(b.meta || {});
      if (audit && !m.appSecret) throw new AppError(400, 'Para auditar pela API oficial, informe o App Secret: é ele que protege o recebimento das mensagens.');
      if (await prisma.instance.findFirst({ where: { userId: req.user.id, purpose, metaPhoneNumberId: m.phoneNumberId }, select: { id: true } })) {
        throw new AppError(409, 'Este Phone Number ID já está cadastrado.');
      }
      const info = await meta.checkPhone({ phoneNumberId: m.phoneNumberId, token: m.accessToken }); // falha com mensagem clara se a Meta recusar
      if (audit) await meta.subscribeApp({ businessId: m.businessId, token: m.accessToken });
      const created = await prisma.instance.create({
        data: {
          userId: req.user.id, name, purpose, provider: 'meta', label,
          metaPhoneNumberId: m.phoneNumberId, metaBusinessId: m.businessId, metaAccessToken: encrypt(m.accessToken),
          metaAppSecret: m.appSecret ? encrypt(m.appSecret) : null, metaVerifyToken: crypto.randomBytes(18).toString('hex'),
          metaPhoneDisplay: info.display || null,
        },
        select: SELECT,
      });
      return res.status(201).json({ instance: publicInstance(created, { state: 'open', connected: true }), connected: true, qr: null, pairingCode: null });
    }

    let data;
    const opts = audit ? { webhookUrl: evolutionWebhookUrl(name) } : {};
    try {
      data = await evo.createInstance(name, opts);
    } catch (e) {
      // Instância já existe na Evolution (ex.: criada antes): só pede o QR de novo.
      if (e.upstreamStatus === 403 || e.upstreamStatus === 409) data = await evo.connectInstance(name);
      else throw e;
    }
    const created = await prisma.instance.create({ data: { userId: req.user.id, name, purpose, provider: 'evolution', label }, select: SELECT });
    await ensureAuditWebhook(name);
    res.status(201).json({ instance: publicInstance(created), connected: false, ...evo.normalizeQr(data) });
  });

  // Renomear e, na API oficial, trocar token / App Secret / IDs.
  router.patch('/:id', async (req, res) => {
    const inst = await own(req);
    const b = req.body || {};
    const data = {};
    if (b.label !== undefined) data.label = cleanLabel(b.label);
    if (inst.provider === 'meta' && b.meta && typeof b.meta === 'object') {
      const m = cleanMeta(b.meta, { partial: true });
      const phoneNumberId = m.phoneNumberId ?? inst.metaPhoneNumberId;
      const token = m.accessToken ?? meta.tokenOf(inst);
      if (!token) throw new AppError(400, 'Cadastre o token de acesso de novo.');
      if (m.phoneNumberId || m.accessToken) {
        const info = await meta.checkPhone({ phoneNumberId, token });
        data.metaPhoneDisplay = info.display || null;
      }
      if (m.phoneNumberId) data.metaPhoneNumberId = m.phoneNumberId;
      if (m.businessId !== undefined) data.metaBusinessId = m.businessId;
      if (m.accessToken) data.metaAccessToken = encrypt(m.accessToken);
      if (m.appSecret) data.metaAppSecret = encrypt(m.appSecret);
      meta.forget(inst.id);
    }
    if (!Object.keys(data).length) throw new AppError(400, 'Nada para atualizar.');
    const updated = await prisma.instance.update({ where: { id: inst.id }, data, select: SELECT });
    res.json({ instance: publicInstance(updated) });
  });

  router.post('/:id/connect', async (req, res) => {
    const inst = await own(req);
    if (inst.provider === 'meta') {
      meta.forget(inst.id);
      const state = await wa.getState(inst);
      if (state !== 'open') throw new AppError(400, 'A Meta recusou o token. Atualize o token de acesso desta conexão.', 'META_AUTH');
      return res.json({ connected: true, qr: null, pairingCode: null });
    }
    const state = await evo.getState(inst.name);
    if (state === 'open') {
      await ensureAuditWebhook(inst.name);
      return res.json({ connected: true, qr: null, pairingCode: null });
    }
    const data = state === 'missing' ? await evo.createInstance(inst.name, audit ? { webhookUrl: evolutionWebhookUrl(inst.name) } : {}) : await evo.connectInstance(inst.name);
    await ensureAuditWebhook(inst.name);
    res.json({ connected: false, ...evo.normalizeQr(data) });
  });

  router.post('/:id/logout', async (req, res) => {
    const inst = await own(req);
    if (inst.provider === 'meta') throw new AppError(400, 'A API oficial não tem "desconectar": para parar de usar, remova esta conexão.');
    try {
      await evo.logoutInstance(inst.name);
    } catch (e) {
      if (e.upstreamStatus !== 404 && e.upstreamStatus !== 400) throw e;
    }
    res.json({ ok: true });
  });

  router.delete('/:id', async (req, res) => {
    const inst = await own(req);
    if (inst.provider === 'evolution') await evo.deleteInstance(inst.name);
    await prisma.instance.delete({ where: { id: inst.id } }); // apaga junto as conversas e anotações da auditoria
    meta.forget(inst.id);
    res.json({ ok: true });
  });

  if (audit) {
    // "Sincronizar agora": busca TODO o histórico que a Evolution tem, em segundo plano (o progresso aparece na tela).
    // A busca normal já roda sozinha; este botão serve para forçar a importação completa.
    router.post('/:id/sync', async (req, res) => {
      const inst = await own(req);
      if (inst.provider !== 'evolution') throw new AppError(400, 'A API oficial da Meta não permite buscar o histórico: só as mensagens novas chegam.');
      if (syncState(inst.id)?.running) return res.json({ started: false, running: true });
      syncInstance({ ...inst, user: req.user }, { deep: true }).catch((e) => console.warn(`[auditoria] sincronização de ${inst.name}: ${e.message}`));
      return res.json({ started: true, running: true });
    });
  }

  return router;
}

export default instanceRouter('envio');
