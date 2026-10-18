// Teste de ponta a ponta do backend: cria um banco PostgreSQL temporário, aplica as migrações,
// sobe Evolution e InfinitePay falsas + o servidor e percorre o fluxo completo.
//
//   SMOKE_DATABASE_URL="postgres://usuario:senha@host:5432/postgres" npm run smoke
//
// O usuário precisa poder criar bancos (CREATEDB). O banco temporário é apagado no final.
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { dueForMonthOffset, zonedToUtc, parseISODate, toISODate } from '../server/utils/schedule.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminUrl = process.env.SMOKE_DATABASE_URL;
if (!adminUrl) {
  console.error('Defina SMOKE_DATABASE_URL (ex.: postgres://usuario:senha@localhost:5432/postgres)');
  process.exit(1);
}

// ---------- serviços falsos ----------
const sent = [];
let evoState = 'close';
const readBody = (req) => new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(s ? JSON.parse(s) : {})); });
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

const evoCalls = []; // chamadas à Evolution que a auditoria faz (criar com webhook, ligar webhook...)
let evoSeq = 0;
const evo = http.createServer(async (req, res) => {
  const b = await readBody(req);
  if (req.headers.apikey !== 'k') return json(res, 401, { message: 'unauthorized' });
  evoCalls.push({ url: req.url, body: b });
  if (req.url === '/instance/create') return json(res, 201, { instance: { instanceName: b.instanceName }, qrcode: { base64: 'data:image/png;base64,AAAA' } });
  if (req.url.startsWith('/webhook/set/')) return json(res, 201, { webhook: b.webhook });
  if (req.url.startsWith('/chat/findChats/')) return json(res, 200, [{ remoteJid: '5585911112222@s.whatsapp.net', name: 'Histórico Hugo' }]);
  if (req.url.startsWith('/chat/findMessages/')) return json(res, 200, { messages: { records: [
    { key: { remoteJid: b.where.key.remoteJid, fromMe: false, id: 'HIST1' }, pushName: 'Histórico Hugo', message: { conversation: 'mensagem antiga 1' }, messageTimestamp: 1700000000 },
    { key: { remoteJid: b.where.key.remoteJid, fromMe: true, id: 'HIST2' }, message: { conversation: 'mensagem antiga 2' }, messageTimestamp: 1700000100 }] } });
  if (req.url.startsWith('/instance/connect/')) return json(res, 200, { base64: 'AAAA' });
  if (req.url.startsWith('/instance/connectionState/')) return json(res, 200, { instance: { state: evoState } });
  if (req.url.startsWith('/instance/logout/')) { evoState = 'close'; return json(res, 200, {}); }
  if (req.url.startsWith('/instance/delete/')) return json(res, 200, {});
  if (req.url.startsWith('/message/sendText/')) { sent.push(b); return json(res, 201, { key: { id: `EVOSENT${++evoSeq}` } }); }
  json(res, 404, { message: 'not found' });
});
let paid = false;
const orders = {}; // valor cobrado em cada pedido (a InfinitePay falsa confirma o valor certo)
const ip = http.createServer(async (req, res) => {
  const b = await readBody(req);
  if (req.url === '/links') { orders[b.order_nsu] = b.items[0].price; return json(res, 200, { url: `https://checkout.example/pay?o=${b.order_nsu}` }); }
  if (req.url === '/payment_check') return json(res, 200, { success: true, paid, amount: orders[b.order_nsu] });
  json(res, 404, {});
});

// API oficial da Meta (Graph) falsa: token BOMTOKEN... funciona; qualquer outro dá erro 190.
const metaSent = [];
const GOOD = 'EAAGgoodtoken1234567890';
const graph = http.createServer(async (req, res) => {
  const b = await readBody(req);
  if (req.headers.authorization !== `Bearer ${GOOD}`) return json(res, 401, { error: { code: 190, message: 'Invalid OAuth access token.' } });
  const m = /^\/v21\.0\/(\d+)(\/messages|\/subscribed_apps)?/.exec(req.url);
  if (!m) return json(res, 404, { error: { message: 'x' } });
  if (m[2] === '/messages') { metaSent.push({ phoneId: m[1], ...b }); return json(res, 200, { messages: [{ id: `wamid.SENT${metaSent.length}` }] }); }
  if (m[2] === '/subscribed_apps') return json(res, 200, { success: true });
  if (m[1] === '999000111') return json(res, 400, { error: { code: 100, message: 'Unsupported get request.' } });
  return json(res, 200, { display_phone_number: '+55 85 99999-0000', verified_name: 'Loja Teste' });
});
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const evoPort = await listen(evo);
const ipPort = await listen(ip);
const graphPort = await listen(graph);

// ---------- banco temporário ----------
const dbName = `dm_smoke_${Date.now()}`;
const base = new pg.Client({ connectionString: adminUrl });
await base.connect();
await base.query(`CREATE DATABASE "${dbName}"`);
const dbUrl = new URL(adminUrl); dbUrl.pathname = `/${dbName}`;
const db = new pg.Client({ connectionString: dbUrl.toString() });
await db.connect();
const migDir = path.join(root, 'prisma', 'migrations');
for (const dir of fs.readdirSync(migDir).filter((d) => fs.statSync(path.join(migDir, d)).isDirectory()).sort()) {
  await db.query(fs.readFileSync(path.join(migDir, dir, 'migration.sql'), 'utf8'));
}

const port = 3999;
const server = spawn('node', ['server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), DATABASE_URL: dbUrl.toString(), JWT_SECRET: 'x'.repeat(40), APP_URL: 'http://localhost:5173',
    EVOLUTION_API_URL: `http://127.0.0.1:${evoPort}`, EVOLUTION_API_KEY: 'k', EVOLUTION_MESSAGE_DELAY_MS: '50',
    META_GRAPH_URL: `http://127.0.0.1:${graphPort}`, ENCRYPTION_KEY: 'chave-de-teste-para-tokens', INFINITEPAY_HANDLE: 'loja', INFINITEPAY_API_URL: `http://127.0.0.1:${ipPort}`, SCHEDULER_INTERVAL_SECONDS: '1',
    ADMIN_EMAIL: 'admin@t.com', ADMIN_PASSWORD: 'admin12345', APP_TIMEZONE: 'America/Sao_Paulo' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('envio automático ligado') && r()));

const jar = {};
const client = (name) => {
  jar[name] = '';
  return async (method, url, body) => {
    const res = await fetch(`http://localhost:${port}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: jar[name] }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) jar[name] = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
};
const ok = (m) => console.log('  ✓', m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn, what, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`tempo esgotado esperando: ${what}`);
    await sleep(300);
  }
}
const plusDays = (n) => toISODate(new Date(Date.now() + n * 86400000));
const forceDue = (id, minutesAgo = 1) => db.query(`UPDATE schedules SET next_run_at = now() - ($2 || ' minutes')::interval WHERE id = $1`, [id, String(minutesAgo)]);
const row = async (id) => (await db.query('SELECT * FROM schedules WHERE id = $1', [id])).rows[0];
const norm = (s) => s.replace(/\u00a0/g, ' ');

try {
  // ===== utilitários de data e fuso =====
  assert.equal(toISODate(dueForMonthOffset(parseISODate('2027-01-31'), 1)), '2027-02-28');
  assert.equal(toISODate(dueForMonthOffset(parseISODate('2028-01-31'), 1)), '2028-02-29');
  assert.equal(toISODate(dueForMonthOffset(parseISODate('2027-01-31'), 2)), '2027-03-31');
  assert.equal(toISODate(dueForMonthOffset(parseISODate('2026-12-15'), 1)), '2027-01-15');
  assert.equal(zonedToUtc(parseISODate('2026-11-08'), '09:00', 'America/Sao_Paulo').toISOString(), '2026-11-08T12:00:00.000Z');
  assert.equal(zonedToUtc(parseISODate('2026-11-08'), '09:00', 'America/Manaus').toISOString(), '2026-11-08T13:00:00.000Z');
  ok('vencimento mensal (dia 31 em mês curto, ano bissexto) e fuso horário');

  // ===== conta =====
  const u = client('u'), a = client('a'), other = client('other');
  let r = await u('POST', '/auth/register', { kind: 'PF', name: 'Maria Teste', document: '111.444.777-35', email: 'maria@t.com', phone: '(85) 99999-1234', password: 'senha12345', plan: 'prata' });
  assert.equal(r.status, 201); assert.equal(r.body.user.role, 'usuario'); assert.equal(r.body.user.access.daysLeft, 3);
  ok('cadastro PF no PostgreSQL com teste grátis de 3 dias');
  r = await client('x')('POST', '/auth/register', { kind: 'PF', name: 'Maria 2', document: '111.444.777-35', email: 'm2@t.com', password: 'senha12345' });
  assert.equal(r.status, 409); ok('CPF duplicado é recusado');
  r = await other('POST', '/auth/register', { kind: 'PJ', name: 'Empresa LTDA', document: '11.222.333/0001-81', email: 'e@t.com', password: 'senha12345' });
  assert.equal(r.status, 201); ok('cadastro PJ com CNPJ');

  // ===== clientes =====
  r = await u('POST', '/contacts', { name: 'Maria Souza', phone: '(85) 98888-1111', email: 'ms@x.com' });
  assert.equal(r.status, 201); const maria = r.body.contact; assert.equal(maria.phone, '5585988881111');
  r = await u('POST', '/contacts', { name: 'João Pereira', phone: '85 97777-2222' }); assert.equal(r.status, 201); const joao = r.body.contact;
  r = await u('POST', '/contacts', { name: 'Outro', phone: '85988881111' }); assert.equal(r.status, 409); ok('cliente salvo; número repetido é recusado');
  r = await u('POST', '/contacts', { name: 'X', phone: '123' }); assert.equal(r.status, 400);
  r = await u('GET', '/contacts?q=mar'); assert.equal(r.body.contacts.length, 1); assert.equal(r.body.total, 2);
  r = await u('GET', '/contacts?q=2222'); assert.equal(r.body.contacts[0].name, 'João Pereira');
  r = await u('GET', '/contacts?q=PEREIRA'); assert.equal(r.body.contacts.length, 1); ok('busca de clientes por nome (sem diferenciar maiúsculas) e por telefone');
  r = await other('GET', `/contacts`); assert.equal(r.body.total, 0);
  r = await other('PATCH', `/contacts/${maria.id}`, { name: 'Hack', phone: '85988881111' }); assert.equal(r.status, 404); ok('um usuário não enxerga os clientes do outro');

  // ===== WhatsApp =====
  r = await u('POST', '/instances'); assert.equal(r.status, 201); assert.equal(r.body.instance.name, '11144477735');
  evoState = 'open'; r = await u('GET', '/instances'); assert.equal(r.body.instances[0].connected, true); ok('instância com nome do CPF; luz verde quando conectado');

  // ===== validações =====
  const D = plusDays(6);
  const base = { kind: 'cobranca', recurrence: 'avulsa', contactId: maria.id, amountCents: 15000, dueDate: D, daysBefore: 1, sendTime: '09:00', text: 'Olá {nome}, sua fatura de {valor} vence em {vencimento}.', extra: 'chave-pix-123' };
  const bad = async (patch, msg) => { const x = await u('POST', '/schedules', { ...base, ...patch }); assert.equal(x.status, 400, msg); };
  await bad({ dueDate: plusDays(-3) }, 'data passada'); await bad({ dueDate: '31/12/2026' }, 'formato de data');
  await bad({ daysBefore: 31 }, 'antecedência'); await bad({ sendTime: '25:00' }, 'horário'); await bad({ amountCents: undefined }, 'valor obrigatório na cobrança');
  await bad({ recurrence: 'mensal', sendMode: 'agora' }, 'agora + mensal'); await bad({ text: '   ' }, 'texto vazio'); await bad({ contactId: 99999 }, 'cliente inexistente');
  ok('validações: data passada, formato, antecedência, horário, valor, texto e cliente');

  // ===== agendamentos =====
  r = await u('POST', '/schedules', base);
  assert.equal(r.status, 201); const avulsa = r.body.schedule;
  const expectedRun = `${plusDays(5)}T12:00:00.000Z`; // (vencimento - 1 dia) às 09:00 em Brasília = 12:00 UTC
  assert.equal(new Date(avulsa.nextRunAt).toISOString(), expectedRun); assert.equal(avulsa.status, 'ativa');
  ok('cobrança avulsa agendada para 1 dia antes às 09:00 (horário de Brasília)');

  const yesterday = plusDays(-1);
  r = await u('POST', '/schedules', { ...base, recurrence: 'mensal', amountCents: 20000, dueDate: yesterday, daysBefore: 0, sendTime: '00:00', contactId: joao.id });
  assert.equal(r.status, 201); const mensal = r.body.schedule;
  assert.equal(mensal.nextDueDate, toISODate(dueForMonthOffset(parseISODate(yesterday), 1))); ok('cobrança mensal: começa no próximo mês quando o horário do mês atual já passou');

  r = await u('POST', '/schedules', { kind: 'lembrete', recurrence: 'avulsa', newContact: { name: 'Ana Nova', phone: '(85) 96666-3333' }, dueDate: D, daysBefore: 2, sendTime: '08:30', text: 'Oi {nome}! Lembrete {valor}.' });
  assert.equal(r.status, 201); const lembrete = r.body.schedule; assert.equal(lembrete.amountCents, null);
  r = await u('GET', '/contacts?q=ana'); assert.equal(r.body.contacts.length, 1); ok('lembrete sem valor; cliente novo já é salvo na lista de clientes');

  r = await u('GET', '/schedules?kind=cobranca'); assert.equal(r.body.schedules.length, 2);
  r = await u('GET', '/schedules?kind=lembrete'); assert.equal(r.body.schedules.length, 1);
  r = await u('GET', '/schedules?kind=cobranca&q=jo%C3%A3o'); assert.equal(r.body.schedules.length, 1); ok('listagem por tipo e busca pelo nome do cliente');

  r = await u('GET', '/stats');
  assert.equal(r.body.contacts, 3); assert.equal(r.body.monthlyTotalCents, 20000); assert.equal(r.body.monthlyCount, 1); assert.ok(r.body.expectedMonthCents >= 20000); assert.equal(r.body.upcoming.length, 3);
  ok('estatísticas: clientes cadastrados, total mensal e próximos envios');

  // ===== envio automático =====
  sent.length = 0;
  await forceDue(avulsa.id);
  await eventually(() => sent.length >= 2, 'envio automático em 2 blocos');
  const [msg1, msg2] = sent;
  const dueBR = D.split('-').reverse().join('/');
  assert.equal(msg1.number, '5585988881111'); assert.equal(norm(msg1.text), `Olá Maria, sua fatura de R$ 150,00 vence em ${dueBR}.`); assert.equal(msg2.text, 'chave-pix-123');
  const done = await eventually(async () => { const s = await row(avulsa.id); return s.status === 'concluida' && s; }, 'avulsa concluída');
  assert.equal(done.last_status, 'sent'); assert.equal(done.sent_count, 1); assert.equal(done.next_run_at, null);
  ok('no horário: mensagem com {nome}/{valor}/{vencimento} preenchidos, em 2 blocos; avulsa fica concluída');

  sent.length = 0; await forceDue(mensal.id);
  await eventually(() => sent.length >= 2, 'mensal enviada');
  const m2 = await eventually(async () => { const s = await row(mensal.id); return s.sent_count === 1 && s.next_run_at > new Date() && s; }, 'mensal reprogramada');
  assert.equal(m2.status, 'ativa'); assert.equal(toISODate(m2.next_due_date), toISODate(dueForMonthOffset(parseISODate(yesterday), 2)));
  ok('mensal: após enviar, continua ativa e agenda o mês seguinte');

  // WhatsApp caiu: tenta de novo em 15 min, sem perder o envio
  evoState = 'close'; sent.length = 0; await forceDue(lembrete.id);
  const retry = await eventually(async () => { const s = await row(lembrete.id); return s.attempts === 1 && s; }, 'retentativa');
  assert.equal(sent.length, 0); assert.equal(retry.status, 'ativa'); assert.ok(retry.next_run_at - new Date() > 14 * 60000);
  evoState = 'open'; await forceDue(lembrete.id);
  await eventually(() => sent.length === 1, 'lembrete enviado após reconectar');
  assert.equal(norm(sent[0].text), 'Oi Ana! Lembrete .'); ok('WhatsApp desconectado: reprograma em 15 min e envia quando voltar (sem {valor} no lembrete)');

  // Perdeu o horário (ex.: sistema parado): não manda cobrança velha
  r = await u('POST', '/schedules', { ...base, contactId: joao.id }); const late = r.body.schedule;
  sent.length = 0; await forceDue(late.id, 7 * 60);
  const lateRow = await eventually(async () => { const s = await row(late.id); return s.status === 'concluida' && s; }, 'envio atrasado descartado');
  assert.equal(lateRow.last_status, 'failed'); assert.equal(sent.length, 0); ok('atraso de mais de 6h: não envia cobrança velha e registra a falha');

  // ===== ações manuais =====
  r = await u('POST', `/schedules/${mensal.id}/send-now`); assert.equal(r.status, 200); assert.equal(r.body.schedule.status, 'ativa');
  assert.equal(r.body.schedule.nextRunAt, (await row(mensal.id)).next_run_at.getTime()); ok('"Enviar agora" na mensal não mexe no calendário');
  r = await u('POST', '/schedules', { ...base, contactId: maria.id }); const av2 = r.body.schedule;
  r = await u('POST', `/schedules/${av2.id}/send-now`); assert.equal(r.body.schedule.status, 'concluida'); ok('"Enviar agora" na avulsa cancela o envio agendado (sem duplicar)');

  const before = (await u('GET', '/schedules')).body.schedules.length;
  sent.length = 0;
  r = await u('POST', '/schedules', { ...base, sendMode: 'agora', daysBefore: 0 }); assert.equal(r.status, 201); assert.equal(r.body.schedule.status, 'concluida'); assert.equal(sent.length, 2);
  evoState = 'close'; r = await u('POST', '/schedules', { ...base, sendMode: 'agora' }); assert.equal(r.status, 409); evoState = 'open';
  assert.equal((await u('GET', '/schedules')).body.schedules.length, before + 1); ok('envio imediato: funciona conectado e não deixa registro se o WhatsApp estiver desconectado');

  r = await u('POST', `/schedules/${mensal.id}/pause`); assert.equal(r.body.schedule.status, 'pausada');
  sent.length = 0; await forceDue(mensal.id); await sleep(3500); assert.equal(sent.length, 0); ok('pausado não envia');
  r = await u('POST', `/schedules/${mensal.id}/resume`); assert.equal(r.body.schedule.status, 'ativa'); assert.ok(r.body.schedule.nextRunAt > Date.now());
  r = await u('PATCH', `/schedules/${mensal.id}`, { ...base, recurrence: 'mensal', amountCents: 25000, dueDate: yesterday, daysBefore: 3, sendTime: '10:15' });
  assert.equal(r.status, 200); assert.equal(r.body.schedule.amountCents, 25000); assert.equal(r.body.schedule.sendTime, '10:15'); ok('retomar e editar recalculam a próxima data');

  r = await other('GET', `/schedules/${mensal.id}`); assert.equal(r.status, 404);
  r = await other('DELETE', `/schedules/${mensal.id}`); assert.equal(r.status, 404); ok('um usuário não mexe nas cobranças do outro');

  r = await u('DELETE', `/contacts/${joao.id}`); assert.equal(r.status, 200); assert.ok(r.body.removedSchedules >= 1);
  assert.equal((await db.query('SELECT count(*)::int c FROM schedules WHERE contact_id = $1', [joao.id])).rows[0].c, 0);
  assert.ok((await db.query('SELECT count(*)::int c FROM messages WHERE contact_name = $1', ['João Pereira'])).rows[0].c >= 1);
  ok('excluir cliente apaga as cobranças dele e mantém o histórico de envios');

  r = await u('GET', '/messages?limit=50'); assert.ok(r.body.messages.some((m) => m.automatic) && r.body.messages.some((m) => !m.automatic)); ok('histórico separa envio automático e manual');

  // ===== cobrança paga, faturamento e estrelas =====
  r = await u('POST', '/schedules', { ...base, recurrence: 'mensal', contactId: maria.id, amountCents: 30000, dueDate: plusDays(-40), daysBefore: 0, sendTime: '00:00' });
  assert.equal(r.status, 201); const bill = r.body.schedule; assert.ok(bill.payable.length >= 2); assert.equal(bill.payDefault, bill.dueDate);
  r = await u('POST', `/schedules/${bill.id}/paid`, { paidAt: plusDays(-38) });
  assert.equal(r.status, 201); const pay1 = r.body.payment; assert.equal(pay1.dueDate, bill.dueDate); assert.equal(pay1.lateDays, 2); assert.equal(pay1.amountCents, 30000);
  assert.ok(!r.body.schedule.payable.includes(bill.dueDate)); assert.equal(r.body.schedule.payments.length, 1);
  ok('marcar cobrança como paga: guarda vencimento, dia do pagamento e dias de atraso');

  r = await u('POST', `/schedules/${bill.id}/paid`, { dueDate: bill.dueDate }); assert.equal(r.status, 409);
  r = await u('POST', `/schedules/${bill.id}/paid`, { dueDate: '2020-01-01' }); assert.equal(r.status, 400);
  r = await u('POST', `/schedules/${bill.id}/paid`, { paidAt: plusDays(3) }); assert.equal(r.status, 400);
  r = await u('POST', `/schedules/${lembrete.id}/paid`, {}); assert.equal(r.status, 400);
  r = await other('POST', `/schedules/${bill.id}/paid`, {}); assert.equal(r.status, 404);
  ok('pagamento: não duplica o mesmo vencimento, recusa data futura, lembrete e cobrança de outro usuário');

  const next = (await u('GET', `/schedules/${bill.id}`)).body.schedule.payDefault; assert.ok(next && next !== bill.dueDate);
  r = await u('POST', `/schedules/${bill.id}/paid`, { dueDate: next, paidAt: plusDays(-1) });
  assert.equal(r.status, 201); const pay2 = r.body.payment;

  r = await u('GET', '/receipts/summary?days=30');
  assert.equal(r.status, 200); assert.equal(r.body.periods['30'].count, 1); assert.equal(r.body.periods['30'].totalCents, 30000);
  assert.equal(r.body.periods['60'].count, 2); assert.equal(r.body.periods['60'].totalCents, 60000); assert.equal(r.body.periods['90'].count, 2);
  assert.equal(r.body.totalCents, 30000); assert.equal(r.body.items.length, 1); assert.equal(r.body.series.length, 1);
  r = await u('GET', '/receipts/summary?days=60'); assert.equal(r.body.totalCents, 60000); assert.equal(r.body.averageCents, 30000);
  r = await u('GET', `/receipts/summary?from=${plusDays(-45)}&to=${plusDays(-30)}`); assert.equal(r.body.count, 1); assert.equal(r.body.totalCents, 30000);
  r = await u('GET', `/receipts/summary?from=${plusDays(-5)}&to=${plusDays(-30)}`); assert.equal(r.status, 400);
  r = await other('GET', '/receipts/summary?days=90'); assert.equal(r.body.totalCents, 0);
  ok('faturamento por 30, 60 e 90 dias e por intervalo de datas (cada usuário vê só o seu)');

  r = await u('GET', '/receipts/clients');
  assert.equal(r.body.clients.length, 1); const rate = r.body.clients[0];
  assert.equal(rate.contactId, maria.id); assert.equal(rate.count, 2); assert.equal(rate.totalCents, 60000); assert.ok(rate.usualDay >= 1 && rate.usualDay <= 31);
  assert.equal(rate.stars, Math.min(5, Math.max(1, 5 - Math.round((2 + pay2.lateDays) / 2))));
  ok('avaliação do cliente em estrelas (5 = em dia, uma a menos por dia de atraso em média) com o dia habitual de pagamento');

  // cobrança já paga não é enviada de novo no horário agendado
  r = await u('POST', '/schedules', { ...base, contactId: maria.id }); const prepaid = r.body.schedule;
  r = await u('POST', `/schedules/${prepaid.id}/paid`, {}); assert.equal(r.status, 201); assert.equal(r.body.payment.lateDays, 0);
  sent.length = 0; await forceDue(prepaid.id);
  const skipped = await eventually(async () => { const s = await row(prepaid.id); return s.status === 'concluida' && s; }, 'cobrança paga não é cobrada');
  assert.equal(sent.length, 0); assert.equal(skipped.sent_count, 0); assert.equal(skipped.next_run_at, null);
  ok('cobrança marcada como paga não é enviada de novo');

  r = await u('DELETE', `/receipts/${pay2.id}`); assert.equal(r.status, 200);
  r = await u('DELETE', `/receipts/${pay2.id}`); assert.equal(r.status, 404);
  r = await other('DELETE', `/receipts/${pay1.id}`); assert.equal(r.status, 404);
  assert.equal((await u('GET', '/receipts/summary?days=90')).body.periods['90'].count, 2); // pay1 + a cobrança paga antecipada
  assert.ok((await u('GET', `/schedules/${bill.id}`)).body.schedule.payable.includes(next));
  ok('desfazer pagamento devolve o vencimento para a lista e tira do faturamento');

  // ===== contratos (editor) =====
  const blank = { v: 1, orientation: 'portrait', pages: [{ id: 'p1', bg: '#ffffff', els: [{ id: 'e1', t: 'title', x: 60, y: 60, w: 400, text: 'CONTRATO', fontFamily: 'playfair', fontSize: 28, bold: true, color: '#0f2238', align: 'center' }] }] };
  r = await client('anon')('GET', '/contracts'); assert.equal(r.status, 401);
  r = await u('POST', '/contracts', { name: 'Prestação de serviços', data: blank });
  assert.equal(r.status, 201); assert.equal(r.body.contract.pageCount, 1); assert.equal(r.body.contract.data.pages[0].els[0].text, 'CONTRATO');
  const ct1 = r.body.contract;
  r = await u('GET', '/contracts'); assert.equal(r.body.contracts.length, 1); assert.equal(r.body.limit, 7); assert.equal(r.body.contracts[0].data, undefined);
  r = await u('GET', `/contracts/${ct1.id}`); assert.equal(r.body.contract.data.pages[0].els[0].fontFamily, 'playfair');
  ok('contrato: cria, lista (sem o conteúdo pesado) e abre');

  const png = 'data:image/png;base64,' + 'A'.repeat(400000); // ~400kb: passa do limite de 100kb das outras rotas
  const messy = { v: 1, orientation: 'landscape', pages: [
    { id: 'p1', bg: 'red;background:url(http://evil)', els: [
      { id: 'a', t: 'image', x: 10, y: 10, w: 200, h: 100, src: png, fit: 'cover' },
      { id: 'b', t: 'image', x: 10, y: 10, w: 200, h: 100, src: 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=' },
      { id: 'c', t: 'image', x: 10, y: 10, w: 200, h: 100, src: 'https://evil.example/x.png' },
      { id: 'd', t: 'text', x: 5, y: 5, w: 300, text: '<script>alert(1)</script>', fontFamily: 'comic-sans', color: 'red;position:fixed', fontSize: 9999, opacity: 7, onclick: 'x()' },
      { id: 'e', t: 'hacker', x: 1, y: 1, w: 1 },
      'lixo',
    ] },
    { id: 'p1', els: 'nao-e-lista' },
  ] };
  r = await u('POST', '/contracts', { name: '  Modelo   sujo  ', data: messy });
  assert.equal(r.status, 201, JSON.stringify(r.body)); const dirty = r.body.contract;
  assert.equal(dirty.name, 'Modelo sujo'); assert.equal(dirty.pageCount, 2); assert.equal(dirty.data.orientation, 'landscape');
  const [dp1, dp2] = dirty.data.pages;
  assert.equal(dp1.bg, '#ffffff'); assert.deepEqual(dp1.els.map((e) => e.t), ['image', 'text']); assert.equal(dp1.els[0].src, png);
  const tx = dp1.els[1];
  assert.equal(tx.text, '<script>alert(1)</script>'); assert.equal(tx.fontFamily, undefined); assert.equal(tx.color, undefined);
  assert.equal(tx.fontSize, 300); assert.equal(tx.opacity, 1); assert.equal(tx.onclick, undefined);
  assert.notEqual(dp2.id, dp1.id); assert.deepEqual(dp2.els, []);
  ok('contrato com imagem grande é aceito; SVG, links externos, cores/fontes inválidas e campos desconhecidos são descartados');

  r = await u('PATCH', `/contracts/${ct1.id}`, { name: 'Novo nome' }); assert.equal(r.status, 200); assert.equal(r.body.contract.name, 'Novo nome'); assert.equal(r.body.contract.pageCount, 1);
  r = await u('PATCH', `/contracts/${ct1.id}`, { data: { ...blank, pages: [...blank.pages, { id: 'p2', els: [] }] } }); assert.equal(r.body.contract.pageCount, 2);
  assert.equal((await u('GET', `/contracts/${ct1.id}`)).body.contract.name, 'Novo nome');
  r = await u('PATCH', `/contracts/${ct1.id}`, {}); assert.equal(r.status, 400);
  r = await u('PATCH', `/contracts/${ct1.id}`, { name: '   ' }); assert.equal(r.status, 400);
  r = await u('PATCH', `/contracts/${ct1.id}`, { data: { pages: [] } }); assert.equal(r.status, 400);
  r = await u('POST', '/contracts', { name: 'X', data: { pages: 'oi' } }); assert.equal(r.status, 400);
  ok('contrato: renomear, salvar páginas e recusar dados inválidos');

  r = await other('GET', `/contracts/${ct1.id}`); assert.equal(r.status, 404);
  r = await other('PATCH', `/contracts/${ct1.id}`, { name: 'Hack' }); assert.equal(r.status, 404);
  r = await other('POST', `/contracts/${ct1.id}/duplicate`); assert.equal(r.status, 404);
  r = await other('DELETE', `/contracts/${ct1.id}`); assert.equal(r.status, 404);
  assert.equal((await other('GET', '/contracts')).body.contracts.length, 0);
  ok('um usuário não enxerga nem altera os contratos do outro');

  let ct3 = null; // plano prata: 7 modelos (já temos 2)
  for (let i = 3; i <= 7; i++) { r = await u('POST', '/contracts', { name: `Modelo ${i}`, data: blank }); assert.equal(r.status, 201); ct3 = r.body.contract; }
  r = await u('POST', '/contracts', { name: 'Oitavo', data: blank }); assert.equal(r.status, 403); assert.equal(r.body.code, 'LIMIT_REACHED');
  r = await u('POST', `/contracts/${ct1.id}/duplicate`); assert.equal(r.status, 403);
  r = await u('DELETE', `/contracts/${ct3.id}`); assert.equal(r.status, 200);
  r = await u('POST', `/contracts/${ct1.id}/duplicate`); assert.equal(r.status, 201); assert.equal(r.body.contract.name, 'Novo nome (cópia)'); assert.equal(r.body.contract.pageCount, 2);
  r = await u('GET', `/contracts/${r.body.contract.id}`); assert.equal(r.body.contract.data.pages[0].els[0].text, 'CONTRATO');
  ok('limite de modelos por plano (prata = 7); duplicar e excluir liberam vaga');

  r = await u('POST', '/contracts', { name: 'Gigante', data: { pages: [{ els: [{ t: 'text', x: 0, y: 0, w: 10, text: 'x' }] }], pad: 'x'.repeat(13 * 1024 * 1024) } });
  assert.equal(r.status, 413);
  r = await u('POST', '/contacts', { name: 'Grande', phone: '85999990000', notes: 'x'.repeat(200 * 1024) }); assert.equal(r.status, 413);
  ok('corpo enorme é recusado (413); as outras rotas continuam com o limite de 100kb');

  // ===== fim do teste grátis, bloqueio e pagamento =====
  const pending = await u('POST', '/schedules', { ...base, contactId: maria.id }); const blocked = pending.body.schedule;
  await db.query("UPDATE users SET trial_ends_at = now() - interval '1 second' WHERE email = 'maria@t.com'");
  r = await u('GET', '/schedules'); assert.equal(r.status, 402); assert.equal(r.body.code, 'PAYMENT_REQUIRED');
  sent.length = 0; await forceDue(blocked.id); await sleep(3500); assert.equal(sent.length, 0); ok('sem acesso: API bloqueada e nenhum envio automático sai');
  r = await u('POST', '/billing/checkout', { plan: 'prata' }); assert.equal(r.status, 200);
  const order = decodeURIComponent(r.body.url.split('o=')[1]);
  r = await u('POST', '/billing/confirm', { order_nsu: order, transaction_nsu: 't1', slug: 's1' }); assert.equal(r.status, 402);
  paid = true;
  r = await u('POST', '/billing/confirm', { order_nsu: order, transaction_nsu: 't1', slug: 's1' }); assert.equal(r.body.user.access.status, 'paid'); assert.equal(r.body.user.access.daysLeft, 30);
  r = await u('POST', '/billing/confirm', { order_nsu: order, transaction_nsu: 't1', slug: 's1' }); assert.equal(r.body.user.access.daysLeft, 30);
  r = await u('GET', '/schedules'); assert.equal(r.status, 200); ok('pagamento libera 30 dias (e confirmar de novo não soma dias)');

  // ===== planos e períodos =====
  r = await client('anon')('GET', '/plans'); const P = Object.fromEntries(r.body.plans.map((x) => [x.id, x]));
  assert.deepEqual(P.bronze.prices, { mensal: 3490, semestral: 17450, anual: 31410 });
  assert.deepEqual(P.prata.prices, { mensal: 5490, semestral: 27450, anual: 49410 });
  assert.deepEqual(P.ouro.prices, { mensal: 6490, semestral: 32450, anual: 58410 });
  const lim = (x) => [x.instances, x.auditInstances, x.contracts, x.auditSend];
  assert.deepEqual(lim(P.bronze), [1, 1, 2, false]); assert.deepEqual(lim(P.prata), [1, 3, 7, false]); assert.deepEqual(lim(P.ouro), [3, 5, 20, true]);
  ok('planos: limites e preços (semestral = 5 mensalidades, anual = 9)');
  const daysLeft = async () => (await u('GET', '/auth/me')).body.user.access.daysLeft;
  r = await u('POST', '/billing/checkout', { plan: 'prata', period: 'semestral' }); assert.equal(r.status, 200);
  const o6 = decodeURIComponent(r.body.url.split('o=')[1]); assert.equal(orders[o6], 27450);
  r = await u('POST', '/billing/confirm', { order_nsu: o6, transaction_nsu: 't6', slug: 's6' }); assert.equal(r.body.user.access.daysLeft, 30 + 183);
  r = await u('POST', '/billing/checkout', { plan: 'prata', period: 'anual' });
  const o12 = decodeURIComponent(r.body.url.split('o=')[1]); assert.equal(orders[o12], 49410);
  r = await u('POST', '/billing/confirm', { order_nsu: o12, transaction_nsu: 't12', slug: 's12' }); assert.equal(r.body.user.access.daysLeft, 30 + 183 + 365);
  r = await u('POST', '/billing/checkout', { plan: 'prata', period: 'trimestral' }); assert.equal(orders[decodeURIComponent(r.body.url.split('o=')[1])], 5490); // período inválido vira mensal
  r = await u('GET', '/billing'); assert.deepEqual(r.body.periods.map((x) => [x.id, x.months, x.days]), [['mensal', 1, 30], ['semestral', 6, 183], ['anual', 12, 365]]);
  assert.ok(r.body.payments.some((x) => x.period === 'anual' && x.amountCents === 49410 && x.days === 365));
  ok('pagamento semestral (183 dias) e anual (365 dias) liberam o tempo do período e cobram o valor certo');
  r = await client('w')('POST', '/webhooks/infinitepay', { order_nsu: 'inexistente' }); assert.equal(r.status, 400);


  // ===== auditoria: conexões =====
  r = await u('GET', '/audit/instances'); assert.equal(r.body.limit, 3); assert.equal(r.body.instances.length, 0);
  evoCalls.length = 0;
  r = await u('POST', '/audit/instances', { label: 'Atendimento' }); assert.equal(r.status, 201); assert.equal(r.body.instance.name, '11144477735-aud'); assert.equal(r.body.instance.label, 'Atendimento');
  const aud1 = r.body.instance;
  const createCall = evoCalls.find((c) => c.url === '/instance/create'); const hookUrl = new URL(createCall.body.webhook.url);
  assert.equal(hookUrl.pathname, '/api/webhooks/evolution/11144477735-aud'); assert.ok(hookUrl.searchParams.get('token').length >= 30);
  assert.ok(createCall.body.webhook.events.includes('MESSAGES_UPSERT')); assert.ok(evoCalls.some((c) => c.url === '/webhook/set/11144477735-aud'));
  const hookToken = hookUrl.searchParams.get('token');
  r = await u('GET', '/instances'); assert.equal(r.body.instances.length, 1); assert.equal(r.body.instances[0].name, '11144477735'); // auditoria não aparece nos WhatsApps de envio
  r = await u('POST', '/audit/instances'); assert.equal(r.status, 201); assert.equal(r.body.instance.name, '11144477735-aud-2');
  ok('conexão de auditoria separada da de envio; Evolution recebe o webhook com token');

  // ===== auditoria: mensagens chegando por webhook =====
  const hook = (event, data, token = hookToken, name = '11144477735-aud') => client('hook')('POST', `/webhooks/evolution/${name}?token=${token}`, { event, instance: name, data });
  assert.equal((await hook('messages.upsert', {}, 'errado')).status, 401);
  assert.equal((await hook('messages.upsert', {}, hookToken, '11144477735-aud-2')).status, 401); // o token vale só para a própria conexão
  const T0 = Math.floor(Date.now() / 1000) - 600;
  const txt = (id, text, extra = {}) => ({ key: { remoteJid: '5585988887777@s.whatsapp.net', fromMe: false, id }, pushName: 'Cliente Ana', message: { conversation: text }, messageTimestamp: T0, ...extra });
  assert.equal((await hook('MESSAGES_UPSERT', txt('M1', 'Olá, qual o preço do orçamento?'))).status, 200);
  await hook('messages.upsert', txt('M1', 'duplicada'));
  await hook('messages.upsert', txt('M2', 'Pode fechar', { messageTimestamp: T0 + 60 }));
  await hook('messages.upsert', { key: { remoteJid: '5585988887777@s.whatsapp.net', fromMe: true, id: 'M3' }, message: { extendedTextMessage: { text: 'Claro, vou mandar o contrato' } }, messageTimestamp: T0 + 120 });
  await hook('messages.upsert', { key: { remoteJid: '5585988887777@s.whatsapp.net', fromMe: false, id: 'M4' }, pushName: 'Cliente Ana', message: { imageMessage: { caption: 'comprovante do pix' } }, messageTimestamp: T0 + 180 });
  await hook('messages.upsert', { key: { remoteJid: '5585988887777@s.whatsapp.net', fromMe: false, id: 'M5' }, message: { reactionMessage: { text: '👍' } }, messageTimestamp: T0 + 200 });
  await hook('messages.upsert', { key: { remoteJid: 'status@broadcast', fromMe: false, id: 'S1' }, message: { conversation: 'status' }, messageTimestamp: T0 });
  await hook('messages.upsert', { key: { remoteJid: '120363000000000000@g.us', fromMe: false, id: 'G1', participant: '5585977776666@s.whatsapp.net' }, pushName: 'Beto', message: { ephemeralMessage: { message: { conversation: 'oi grupo' } } }, messageTimestamp: T0 + 30 });
  r = await u('GET', '/audit/chats'); assert.equal(r.body.chats.length, 2);
  const ana = r.body.chats.find((c) => c.phone === '5585988887777'); const grp = r.body.chats.find((c) => c.isGroup);
  assert.equal(ana.name, 'Cliente Ana'); assert.equal(ana.unread, 3); assert.equal(ana.lastText, 'comprovante do pix'); assert.equal(ana.instanceId, aud1.id); assert.equal(r.body.chats[0].id, ana.id);
  assert.equal(grp.lastText, 'oi grupo');
  r = await u('GET', `/audit/chats/${ana.id}/messages`); assert.deepEqual(r.body.messages.map((m) => m.body), ['Olá, qual o preço do orçamento?', 'Pode fechar', 'Claro, vou mandar o contrato', 'comprovante do pix']);
  assert.equal(r.body.messages[2].fromMe, true); assert.equal(r.body.messages[3].type, 'image'); assert.equal(r.body.hasOlder, false);
  r = await u('GET', `/audit/chats/${grp.id}/messages`); assert.equal(r.body.messages[0].sender, 'Beto');
  ok('webhook: texto, imagem, grupo, mensagem enviada; duplicadas, reações e status são ignorados');

  await hook('messages.update', [{ keyId: 'M3', status: 'READ' }]); await hook('messages.update', [{ keyId: 'M3', status: 'SERVER_ACK' }]);
  r = await u('GET', `/audit/chats/${ana.id}/messages`); assert.equal(r.body.messages[2].status, 'read'); ok('status da mensagem só avança (lido não volta para enviado)');

  // ===== auditoria: busca, leitura, etiquetas e anotações =====
  r = await u('GET', `/audit/chats/${ana.id}/search?q=ORÇAMENTO`); assert.equal(r.body.total, 1); assert.match(r.body.matches[0].snippet, /orçamento/);
  r = await u('GET', `/audit/chats/${ana.id}/search?q=preco`); assert.equal(r.body.total, 1);
  r = await u('GET', `/audit/chats/${ana.id}/search?q=a`); assert.equal(r.status, 400);
  r = await u('GET', '/audit/chats?q=comprovante'); assert.equal(r.body.chats.length, 1); assert.equal(r.body.chats[0].match, 'comprovante do pix');
  r = await u('GET', '/audit/chats?q=cliente ana'); assert.equal(r.body.chats.length, 1); r = await u('GET', '/audit/chats?q=88887777'); assert.equal(r.body.chats.length, 1);
  r = await u('GET', '/audit/chats?q=inexistente'); assert.equal(r.body.chats.length, 0);
  ok('busca por palavra-chave (sem acento e sem diferenciar maiúsculas) na conversa e em todas as conversas');

  r = await u('POST', `/audit/chats/${ana.id}/read`); assert.equal(r.status, 200); r = await u('GET', '/audit/chats?unread=1'); assert.equal(r.body.chats.length, 1); assert.equal(r.body.chats[0].id, grp.id);
  r = await u('POST', '/audit/labels', { name: 'Cliente VIP', color: '#e5484d' }); assert.equal(r.status, 201); const vip = r.body.label;
  r = await u('POST', '/audit/labels', { name: 'cliente vip' }); assert.equal(r.status, 201); // outro nome (diferencia maiúsculas)
  r = await u('POST', '/audit/labels', { name: 'Cliente VIP' }); assert.equal(r.status, 409);
  r = await u('POST', '/audit/labels', { name: 'X', color: 'red' }); assert.equal(r.status, 400);
  r = await u('POST', '/audit/labels', { name: '' }); assert.equal(r.status, 400);
  r = await u('PUT', `/audit/chats/${ana.id}/labels`, { labelIds: [vip.id, 99999] }); assert.deepEqual(r.body.labelIds, [vip.id]);
  r = await u('GET', `/audit/chats?labelId=${vip.id}`); assert.equal(r.body.chats.length, 1); assert.deepEqual(r.body.chats[0].labelIds, [vip.id]);
  r = await u('PATCH', `/audit/labels/${vip.id}`, { name: 'VIP', color: '#1f55a6' }); assert.equal(r.body.label.name, 'VIP');
  r = await u('GET', '/audit/labels'); assert.equal(r.body.labels.find((l) => l.id === vip.id).count, 1);
  ok('etiquetas: criar, repetir (409), validar, aplicar na conversa, filtrar, renomear e contar');
  r = await u('PUT', `/audit/chats/${ana.id}/note`, { note: 'Pediu desconto de 10%.\nLigar na sexta.' }); assert.equal(r.status, 200);
  r = await u('GET', `/audit/chats/${ana.id}`); assert.equal(r.body.chat.note, 'Pediu desconto de 10%.\nLigar na sexta.'); assert.ok(r.body.chat.noteUpdatedAt);
  r = await u('PUT', `/audit/chats/${ana.id}/note`, { note: 'x'.repeat(20001) }); assert.equal(r.status, 400);
  ok('bloco de anotações da conversa');
  r = await other('GET', `/audit/chats/${ana.id}`); assert.equal(r.status, 404); r = await other('GET', '/audit/chats'); assert.equal(r.body.chats.length, 0);
  r = await other('PUT', `/audit/chats/${ana.id}/note`, { note: 'hack' }); assert.equal(r.status, 404); r = await other('PATCH', `/audit/labels/${vip.id}`, { name: 'hack' }); assert.equal(r.status, 404);
  r = await other('POST', `/audit/instances/${aud1.id}/sync`); assert.equal(r.status, 404); r = await other('GET', '/audit/labels'); assert.equal(r.body.labels.length, 0);
  ok('um usuário não enxerga conversas, etiquetas nem conexões de auditoria do outro');

  // ===== auditoria: paginação, histórico e corpo grande =====
  const many = Array.from({ length: 60 }, (_, i) => ({ key: { remoteJid: '5585900001111@s.whatsapp.net', fromMe: i % 2 === 0, id: `P${i}` }, pushName: 'Paulo', message: { conversation: `mensagem número ${i}` }, messageTimestamp: T0 + i }));
  await hook('messages.upsert', many);
  r = await u('GET', '/audit/chats'); const paulo = r.body.chats.find((c) => c.name === 'Paulo'); assert.ok(paulo);
  r = await u('GET', `/audit/chats/${paulo.id}/messages`); assert.equal(r.body.messages.length, 50); assert.equal(r.body.hasOlder, true); assert.equal(r.body.messages.at(-1).body, 'mensagem número 59'); assert.equal(r.body.messages[0].body, 'mensagem número 10');
  const first = r.body.messages[0]; r = await u('GET', `/audit/chats/${paulo.id}/messages?before=${first.ts}_${first.id}`); assert.equal(r.body.messages.length, 10); assert.equal(r.body.hasOlder, false); assert.equal(r.body.messages[0].body, 'mensagem número 0');
  r = await u('GET', `/audit/chats/${paulo.id}/search?q=numero 7`); const hit7 = r.body.matches.find((m) => /número 7$/.test(m.snippet)) || r.body.matches[0];
  r = await u('GET', `/audit/chats/${paulo.id}/messages?around=${hit7.id}`); assert.ok(r.body.messages.some((m) => m.id === hit7.id)); assert.equal(r.body.hasNewer, true);
  r = await u('GET', `/audit/chats/${paulo.id}/messages?around=999999`); assert.equal(r.status, 404);
  ok('paginação (50 por vez), mensagens mais antigas e "ir até a mensagem encontrada"');
  r = await client('hook')('POST', `/webhooks/evolution/11144477735-aud?token=${hookToken}`, { event: 'contacts.upsert', data: Array.from({ length: 2500 }, (_, i) => ({ remoteJid: `55859${String(i).padStart(8, '0')}@s.whatsapp.net`, pushName: `Contato ${i}` })) });
  assert.equal(r.status, 200); ok('webhook aceita lote grande de contatos (mais de 100 kb)');
  r = await u('POST', `/audit/instances/${aud1.id}/sync`); assert.equal(r.body.imported, 2);
  r = await u('GET', '/audit/chats?q=Hugo'); const hugo = r.body.chats[0]; assert.equal(hugo.unread, 0); assert.equal(hugo.name, 'Histórico Hugo');
  r = await u('GET', `/audit/chats/${hugo.id}/messages`); assert.deepEqual(r.body.messages.map((m) => m.body), ['mensagem antiga 1', 'mensagem antiga 2']); ok('sincronizar histórico da Evolution (sem marcar como não lido)');

  // ===== auditoria: tempo real (SSE) =====
  const ctl = new AbortController();
  const sse = await fetch(`http://localhost:${port}/api/audit/stream`, { headers: { Cookie: jar.u }, signal: ctl.signal });
  assert.equal(sse.status, 200); assert.match(sse.headers.get('content-type'), /text\/event-stream/);
  const reader = sse.body.getReader(); let buf = '';
  const nextEvent = async (pred) => { for (;;) { const m = /data: (.*)\n\n/.exec(buf); if (m) { buf = buf.slice(m.index + m[0].length); const ev = JSON.parse(m[1]); if (pred(ev)) return ev; continue; } const { value, done } = await reader.read(); if (done) throw new Error('SSE fechou'); buf += Buffer.from(value).toString(); } };
  await hook('messages.upsert', txt('RT1', 'mensagem em tempo real', { messageTimestamp: Math.floor(Date.now() / 1000) }));
  const ev = await Promise.race([nextEvent((e) => e.type === 'message'), sleep(4000).then(() => { throw new Error('evento em tempo real não chegou'); })]);
  assert.equal(ev.message.body, 'mensagem em tempo real'); assert.equal(ev.chat.id, ana.id); assert.equal(ev.chat.unread, 1);
  assert.equal((await client('anon')('GET', '/audit/stream')).status, 401);
  ctl.abort(); ok('tempo real: a mensagem aparece na hora no navegador (SSE), só para o dono');

  // ===== auditoria: enviar mensagem (só plano Ouro) =====
  r = await u('POST', `/audit/chats/${ana.id}/send`, { text: 'oi' }); assert.equal(r.status, 403); assert.equal(r.body.code, 'PLAN_NO_SEND');
  ok('plano Prata só visualiza: tentar enviar pela auditoria é bloqueado');

  // ===== API oficial da Meta =====
  const meta = { phoneNumberId: '100200300400', businessId: '555666777', accessToken: GOOD, appSecret: 'segredo-do-app-meta-1234' };
  r = await u('POST', '/audit/instances', { provider: 'meta', meta: { ...meta, appSecret: '' } }); assert.equal(r.status, 400); assert.match(r.body.error, /App Secret/);
  r = await u('POST', '/audit/instances', { provider: 'meta', meta: { ...meta, accessToken: 'EAAGbadtoken000000000000' } }); assert.equal(r.status, 400); assert.equal(r.body.code, 'META_AUTH'); assert.match(r.body.error, /token/i);
  r = await u('POST', '/audit/instances', { provider: 'meta', meta: { ...meta, phoneNumberId: '12' } }); assert.equal(r.status, 400);
  r = await u('POST', '/audit/instances', { provider: 'meta', meta: { ...meta, phoneNumberId: '999000111' } }); assert.equal(r.status, 400); assert.match(r.body.error, /Phone Number ID/);
  r = await u('POST', '/audit/instances', { provider: 'meta', label: 'Loja oficial', meta }); assert.equal(r.status, 201, JSON.stringify(r.body));
  const mi = r.body.instance; assert.equal(mi.provider, 'meta'); assert.equal(mi.connected, true); assert.equal(mi.metaPhoneDisplay, '+55 85 99999-0000'); assert.equal(mi.hasToken, true); assert.equal(mi.hasAppSecret, true);
  assert.equal(JSON.stringify(r.body).includes(GOOD), false); assert.equal(JSON.stringify(r.body).includes(meta.appSecret), false);
  const stored = (await db.query('SELECT meta_access_token, meta_app_secret, meta_verify_token FROM instances WHERE id = $1', [mi.id])).rows[0];
  assert.ok(stored.meta_access_token.startsWith('v1.') && !stored.meta_access_token.includes(GOOD)); assert.ok(!stored.meta_app_secret.includes(meta.appSecret));
  r = await u('GET', '/audit/instances'); assert.equal(JSON.stringify(r.body).includes(GOOD), false); assert.equal(r.body.instances.find((i) => i.id === mi.id).connected, true);
  r = await u('POST', '/audit/instances', { provider: 'meta', meta }); assert.equal(r.status, 403); assert.equal(r.body.code, 'LIMIT_REACHED'); // prata: 3 números de auditoria (2 QR + 1 oficial)
  r = await u('POST', '/audit/instances', { provider: 'meta', meta }); // limite antes da duplicidade
  ok('API oficial da Meta: campos validados, token conferido na Meta, segredos criptografados e nunca devolvidos');

  r = await client('mh')('GET', `/webhooks/meta?hub.mode=subscribe&hub.verify_token=${stored.meta_verify_token}&hub.challenge=12345`);
  const rawGet = await fetch(`http://localhost:${port}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${stored.meta_verify_token}&hub.challenge=12345`); assert.equal(rawGet.status, 200); assert.equal(await rawGet.text(), '12345');
  assert.equal((await fetch(`http://localhost:${port}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`)).status, 403);
  const metaPayload = { object: 'whatsapp_business_account', entry: [{ id: '555666777', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '558599990000', phone_number_id: meta.phoneNumberId }, contacts: [{ profile: { name: 'Carla Meta' }, wa_id: '5585922223333' }], messages: [{ from: '5585922223333', id: 'wamid.IN1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Boa tarde, quero o orçamento' } }] } }] }] };
  const postMeta = (payload, sig) => { const raw = JSON.stringify(payload); const good = `sha256=${crypto.createHmac('sha256', meta.appSecret).update(raw).digest('hex')}`; return fetch(`http://localhost:${port}/api/webhooks/meta`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig ?? good }, body: raw }); };
  assert.equal((await postMeta(metaPayload, 'sha256=00')).status, 200); r = await u('GET', '/audit/chats?q=Carla'); assert.equal(r.body.chats.length, 0); // assinatura inválida: ignorada
  assert.equal((await postMeta(metaPayload)).status, 200); await postMeta(metaPayload);
  r = await u('GET', '/audit/chats?q=Carla'); assert.equal(r.body.chats.length, 1); const carla = r.body.chats[0]; assert.equal(carla.phone, '5585922223333'); assert.equal(carla.instanceId, mi.id); assert.equal(carla.lastText, 'Boa tarde, quero o orçamento'); assert.equal(carla.unread, 1);
  await postMeta({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: meta.phoneNumberId }, statuses: [{ id: 'wamid.IN1', status: 'read' }] } }] }] });
  ok('webhook da Meta: confirmação do endereço, assinatura obrigatória, mensagem recebida (sem duplicar)');

  // ===== admin =====
  r = await u('GET', '/admin/users'); assert.equal(r.status, 403);
  r = await a('POST', '/auth/login', { identifier: 'admin@t.com', password: 'admin12345' }); assert.equal(r.body.user.role, 'admin');
  r = await a('GET', '/admin/users'); assert.equal(r.body.users.length, 3);
  const maria2 = r.body.users.find((x) => x.email === 'maria@t.com');
  const daysBefore = maria2.access.daysLeft;
  r = await a('PATCH', `/admin/users/${maria2.id}/plan`, { plan: 'ouro' }); assert.equal(r.body.user.limits.instances, 3); assert.equal(r.body.user.limits.auditInstances, 5); assert.equal(r.body.user.limits.contracts, 20); assert.equal(r.body.user.limits.auditSend, true);
  r = await a('POST', `/admin/users/${maria2.id}/grant`); assert.equal(r.body.user.access.daysLeft, daysBefore + 30); ok('admin troca plano e dá acesso mensal (+30 dias)');

  // ===== admin: telefone, última atividade, teste de 3 dias e retroceder =====
  r = await a('GET', '/admin/users'); const lista = r.body.users;
  const mr = lista.find((x) => x.email === 'maria@t.com'); assert.equal(mr.phone, '85999991234'); assert.ok(mr.lastActivityAt > Date.now() - 3600_000); assert.ok(mr.lastActivity);
  assert.equal(mr.lastGrant.kind, 'mensal'); // a liberação acima aparece como "retrocedível"
  const ot = lista.find((x) => x.email === 'e@t.com'); assert.equal(ot.lastGrant, null);
  ok('lista do admin traz telefone, última atividade e a liberação que pode ser desfeita');

  await db.query("UPDATE users SET last_activity_at = now() - interval '10 minutes', last_activity = 'Antigo' WHERE id = $1", [ot.id]);
  await other('GET', '/contacts'); await other('GET', '/schedules'); await other('GET', '/auth/me'); await sleep(200);
  let act = (await db.query('SELECT last_activity_at, last_activity FROM users WHERE id = $1', [ot.id])).rows[0]; assert.equal(act.last_activity, 'Antigo'); // só olhar telas não conta
  r = await other('POST', '/contacts', { name: 'Cliente da Empresa', phone: '85 97777-0001' }); assert.equal(r.status, 201); await sleep(300);
  act = (await db.query('SELECT last_activity_at, last_activity FROM users WHERE id = $1', [ot.id])).rows[0]; assert.equal(act.last_activity, 'Clientes'); assert.ok(Date.now() - act.last_activity_at.getTime() < 10_000);
  r = await a('GET', '/admin/users'); assert.equal(r.body.users.find((x) => x.id === ot.id).lastActivity, 'Clientes');
  ok('última atividade: só conta quando o usuário altera algo (e diz onde); olhar telas não conta');

  const endsAt = async () => (await a('GET', '/admin/users')).body.users.find((x) => x.id === ot.id).access;
  const t0 = (await endsAt()).endsAt; const DAYMS = 86400000;
  r = await a('POST', `/admin/users/${ot.id}/grant`); assert.equal(r.status, 200); assert.equal(r.body.user.access.status, 'paid'); assert.ok(Math.abs(r.body.user.access.endsAt - (t0 + 30 * DAYMS)) < 5000); assert.equal(r.body.user.lastGrant.kind, 'mensal');
  r = await a('POST', `/admin/users/${ot.id}/grant-trial`); assert.equal(r.status, 200); assert.equal(r.body.user.lastGrant.kind, 'teste'); assert.equal(r.body.user.lastGrant.days, 3);
  const trialEnd = (await db.query('SELECT trial_ends_at FROM users WHERE id = $1', [ot.id])).rows[0].trial_ends_at.getTime(); assert.ok(Math.abs(trialEnd - (t0 + 3 * DAYMS)) < 5000);
  r = await a('POST', `/admin/users/${ot.id}/undo-access`); assert.equal(r.status, 200); assert.equal(r.body.undone.kind, 'teste'); assert.equal(r.body.user.lastGrant.kind, 'mensal');
  assert.equal((await db.query('SELECT trial_ends_at FROM users WHERE id = $1', [ot.id])).rows[0].trial_ends_at.getTime(), t0); ok('teste de 3 dias soma 3 dias de teste e "retroceder" desfaz só ele');
  await db.query("UPDATE users SET access_until = access_until + interval '10 days' WHERE id = $1", [ot.id]); // o usuário pagou depois da liberação
  r = await a('POST', `/admin/users/${ot.id}/undo-access`); assert.equal(r.status, 200); assert.equal(r.body.undone.kind, 'mensal');
  assert.ok(Math.abs(r.body.user.access.endsAt - (t0 + 10 * DAYMS)) < 5000, 'o que o usuário pagou continua'); assert.equal(r.body.user.lastGrant, null);
  r = await a('POST', `/admin/users/${ot.id}/undo-access`); assert.equal(r.status, 409); assert.equal(r.body.code, 'NOTHING_TO_UNDO');
  ok('retroceder acesso mensal preserva o pagamento feito depois; sem nada para desfazer avisa');
  await db.query('UPDATE users SET access_until = NULL WHERE id = $1', [ot.id]);
  r = await a('POST', `/admin/users/${ot.id}/grant`); r = await a('POST', `/admin/users/${ot.id}/undo-access`); assert.equal((await db.query('SELECT access_until FROM users WHERE id = $1', [ot.id])).rows[0].access_until, null); assert.equal((await endsAt()).status, 'trial');
  ok('retroceder logo após liberar volta exatamente ao estado anterior (teste grátis)');
  r = await a('GET', `/admin/users/${ot.id}/access-events`); assert.equal(r.body.events.length, 3); assert.ok(r.body.events.every((e) => e.revertedAt && e.adminName === 'Administrador' || e.revertedAt));
  r = await other('POST', `/admin/users/${ot.id}/grant-trial`); assert.equal(r.status, 403); r = await other('POST', `/admin/users/${ot.id}/undo-access`); assert.equal(r.status, 403);
  const adm = (await a('GET', '/admin/users')).body.users.find((x) => x.role === 'admin');
  r = await a('POST', `/admin/users/${adm.id}/grant`); assert.equal(r.status, 400); r = await a('POST', `/admin/users/${adm.id}/undo-access`); assert.equal(r.status, 400);
  ok('histórico das liberações; só o admin usa; administrador não recebe liberação');

  // ===== clientes: dados para variáveis dos contratos =====
  r = await u('POST', '/contacts', { name: 'Cliente Contrato', phone: '85 98888-0001', document: '111.444.777-35', zip: '60000-000', street: ' Rua  das Flores ', number: '12', complement: 'Sala 3', district: 'Centro', city: 'Fortaleza', state: 'ce' });
  assert.equal(r.status, 201, JSON.stringify(r.body)); const cc = r.body.contact;
  assert.deepEqual([cc.document, cc.zip, cc.street, cc.number, cc.complement, cc.district, cc.city, cc.state], ['11144477735', '60000000', 'Rua das Flores', '12', 'Sala 3', 'Centro', 'Fortaleza', 'CE']);
  r = await u('POST', '/contacts', { name: 'CPF Ruim', phone: '85 98888-0002', document: '123.456.789-00' }); assert.equal(r.status, 400); assert.match(r.body.error, /CPF\/CNPJ/);
  r = await u('POST', '/contacts', { name: 'CEP Ruim', phone: '85 98888-0003', zip: '600' }); assert.equal(r.status, 400);
  r = await u('POST', '/contacts', { name: 'UF Ruim', phone: '85 98888-0004', state: 'Ceara' }); assert.equal(r.status, 400);
  r = await u('POST', '/contacts', { name: 'Empresa Cliente', phone: '85 98888-0005', document: '11.222.333/0001-81' }); assert.equal(r.status, 201); assert.equal(r.body.contact.document, '11222333000181');
  r = await u('PATCH', `/contacts/${cc.id}`, { name: 'Cliente Contrato Novo', phone: '85 98888-0001' }); assert.equal(r.body.contact.name, 'Cliente Contrato Novo'); assert.equal(r.body.contact.city, 'Fortaleza'); assert.equal(r.body.contact.document, '11144477735'); // quem não manda o endereço não apaga
  r = await u('PATCH', `/contacts/${cc.id}`, { name: 'Cliente Contrato Novo', phone: '85 98888-0001', city: '', complement: '' }); assert.equal(r.body.contact.city, null); assert.equal(r.body.contact.street, 'Rua das Flores');
  ok('clientes guardam CPF/CNPJ e endereço (validados) para virarem variáveis nos contratos');

  // ===== plano Ouro: responder pela auditoria =====
  sent.length = 0;
  r = await u('POST', `/audit/chats/${ana.id}/send`, { text: '   ' }); assert.equal(r.status, 400);
  r = await u('POST', `/audit/chats/${ana.id}/send`, { text: 'Fechado! Enviei o contrato.' }); assert.equal(r.status, 201); assert.equal(r.body.message.fromMe, true);
  assert.deepEqual(sent.at(-1), { number: '5585988887777', text: 'Fechado! Enviei o contrato.' });
  r = await u('GET', `/audit/chats/${ana.id}/messages`); assert.equal(r.body.messages.filter((m) => m.body === 'Fechado! Enviei o contrato.').length, 1);
  await hook('messages.upsert', { key: { remoteJid: '5585988887777@s.whatsapp.net', fromMe: true, id: `EVOSENT${evoSeq}` }, message: { conversation: 'Fechado! Enviei o contrato.' }, messageTimestamp: Math.floor(Date.now() / 1000) }); // o webhook repete a mesma mensagem
  r = await u('GET', `/audit/chats/${ana.id}/messages`); assert.equal(r.body.messages.filter((m) => m.body === 'Fechado! Enviei o contrato.').length, 1);
  r = await u('POST', `/audit/chats/${grp.id}/send`, { text: 'olá grupo' }); assert.equal(r.status, 201); assert.equal(sent.at(-1).number, '120363000000000000@g.us');
  r = await u('POST', `/audit/chats/${carla.id}/send`, { text: 'Segue o orçamento.' }); assert.equal(r.status, 201);
  assert.deepEqual(metaSent.at(-1), { phoneId: meta.phoneNumberId, messaging_product: 'whatsapp', recipient_type: 'individual', to: '5585922223333', type: 'text', text: { body: 'Segue o orçamento.', preview_url: true } });
  r = await other('POST', `/audit/chats/${ana.id}/send`, { text: 'hack' }); assert.equal(r.status, 403);
  ok('plano Ouro responde pela auditoria (QR Code, grupo e API oficial) sem duplicar a mensagem');

  // ===== API oficial da Meta também para cobranças (WhatsApp de envio) =====
  r = await u('POST', '/instances', { provider: 'meta', label: 'Cobrança oficial', meta: { phoneNumberId: '700800900', accessToken: GOOD } }); assert.equal(r.status, 201, JSON.stringify(r.body)); const mEnvio = r.body.instance;
  r = await u('GET', '/instances'); assert.equal(r.body.instances.length, 2); assert.equal(r.body.instances.find((i) => i.id === mEnvio.id).connected, true); assert.equal(r.body.instances.find((i) => i.id === mEnvio.id).hasAppSecret, false);
  r = await u('PATCH', `/instances/${mEnvio.id}`, { label: 'Renomeada', meta: { accessToken: 'EAAGoutrotoken9999999999', phoneNumberId: '700800900' } }); assert.equal(r.status, 400); assert.equal(r.body.code, 'META_AUTH'); // token novo inválido não é salvo
  r = await u('PATCH', `/instances/${mEnvio.id}`, { label: 'Renomeada' }); assert.equal(r.body.instance.label, 'Renomeada'); assert.equal(r.body.instance.hasToken, true);
  evoState = 'close'; metaSent.length = 0; sent.length = 0;
  r = await u('POST', '/contacts', { name: 'Cliente Meta', phone: '85 96666-5555' }); const cm = r.body.contact;
  r = await u('POST', '/schedules', { ...base, contactId: cm.id, dueDate: plusDays(9) }); assert.equal(r.status, 201, JSON.stringify(r.body));
  await forceDue(r.body.schedule.id);
  await eventually(() => metaSent.length > 0, 'envio automático pela API oficial');
  assert.equal(metaSent[0].to, cm.phone); assert.match(norm(metaSent[0].text.body), /Olá Cliente, sua fatura de R\$ 150,00/); assert.equal(sent.length, 0);
  ok('cobrança automática sai pela API oficial da Meta quando o WhatsApp por QR Code está desconectado');
  r = await u('POST', `/instances/${mEnvio.id}/logout`); assert.equal(r.status, 400);
  r = await u('DELETE', `/instances/${mEnvio.id}`); assert.equal(r.status, 200);
  r = await u('DELETE', `/audit/instances/${aud1.id}`); assert.equal(r.status, 200);
  assert.equal((await db.query('SELECT count(*)::int n FROM audit_chats WHERE instance_id = $1', [aud1.id])).rows[0].n, 0); ok('remover a conexão apaga as conversas dela');
  r = await u('POST', '/audit/instances'); assert.equal(r.status, 201); // vaga liberada (Ouro: 5 números)
  const me = (await a('GET', '/auth/me')).body.user;
  r = await a('DELETE', `/admin/users/${me.id}`); assert.equal(r.status, 400);
  r = await a('DELETE', `/admin/users/${maria2.id}`); assert.equal(r.status, 200);
  const left = (await db.query('SELECT (SELECT count(*) FROM contacts WHERE user_id=$1)::int c, (SELECT count(*) FROM schedules WHERE user_id=$1)::int s, (SELECT count(*) FROM messages WHERE user_id=$1)::int m', [maria2.id])).rows[0];
  assert.deepEqual(left, { c: 0, s: 0, m: 0 }); ok('admin exclui usuário e tudo dele (clientes, cobranças e histórico) é apagado em cascata');
  assert.equal((await db.query('SELECT count(*)::int n FROM contracts WHERE user_id = $1', [maria2.id])).rows[0].n, 0); ok('os contratos do usuário excluído também são apagados');
  const gone = (await db.query('SELECT (SELECT count(*) FROM audit_chats)::int c, (SELECT count(*) FROM audit_messages)::int m, (SELECT count(*) FROM audit_labels)::int l, (SELECT count(*) FROM audit_chat_labels)::int cl, (SELECT count(*) FROM instances WHERE user_id = $1)::int i', [maria2.id])).rows[0];
  assert.deepEqual(gone, { c: 0, m: 0, l: 0, cl: 0, i: 0 }); ok('conversas, mensagens, etiquetas e conexões de auditoria do usuário excluído também são apagadas');

  console.log('\nTudo certo ✔');
} catch (e) {
  console.error('\nFALHOU:', e.message); if (e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n')); process.exitCode = 1;
} finally {
  server.kill(); evo.close(); ip.close(); graph.close();
  await db.end().catch(() => {});
  await base.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
  await base.end().catch(() => {});
}
