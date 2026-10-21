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

const fake = { chats: [], messages: {}, contacts: [], groups: [], media: {}, ascending: false }; // o que a Evolution falsa devolve (cada teste ajusta)
const evoCalls = []; // chamadas à Evolution que a auditoria faz (criar com webhook, ligar webhook...)
let evoSeq = 0;
const evo = http.createServer(async (req, res) => {
  const b = await readBody(req);
  if (req.headers.apikey !== 'k') return json(res, 401, { message: 'unauthorized' });
  evoCalls.push({ url: req.url, body: b });
  if (req.url === '/instance/create') return json(res, 201, { instance: { instanceName: b.instanceName }, qrcode: { base64: 'data:image/png;base64,AAAA' } });
  if (req.url.startsWith('/instance/connect/')) return json(res, 200, { base64: 'AAAA' });
  if (req.url.startsWith('/instance/connectionState/')) return json(res, 200, { instance: { state: evoState } });
  if (req.url.startsWith('/instance/logout/')) { evoState = 'close'; return json(res, 200, {}); }
  if (req.url.startsWith('/instance/delete/')) return json(res, 200, {});
  if (req.url.startsWith('/webhook/set/')) return json(res, 201, { webhook: b.webhook });
  if (req.url.startsWith('/chat/findChats/')) return json(res, 200, fake.chats);
  if (req.url.startsWith('/chat/findMessages/')) { const all = fake.messages[b.where.key.remoteJid] || []; const per = b.offset || 50; const pages = Math.max(1, Math.ceil(all.length / per)); const pg = b.page || 1; return json(res, 200, { messages: { total: all.length, pages, currentPage: pg, records: fake.ascending ? all.slice((pg - 1) * per, pg * per) : [...all].reverse().slice((pg - 1) * per, pg * per) } }); }
  if (req.url.startsWith('/chat/findContacts/')) return json(res, 200, fake.contacts.filter((c) => !b.where?.remoteJid || c.remoteJid === b.where.remoteJid));
  if (req.url.startsWith('/group/fetchAllGroups/')) return json(res, 200, fake.groups);
  if (req.url.startsWith('/chat/getBase64FromMediaMessage/')) { const f = fake.media[b.message.key.id]; return f ? json(res, 201, { base64: f.base64, mimetype: f.mimetype, fileName: f.fileName }) : json(res, 400, { message: 'Message not found' }); }
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
    META_GRAPH_URL: `http://127.0.0.1:${graphPort}`, AUDIT_SYNC_SECONDS: '1', AUDIT_SYNC_IDLE_SECONDS: '2', ENCRYPTION_KEY: 'chave-de-teste-para-tokens', INFINITEPAY_HANDLE: 'loja', INFINITEPAY_API_URL: `http://127.0.0.1:${ipPort}`, SCHEDULER_INTERVAL_SECONDS: '1',
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

  // ===== portfólio (páginas públicas personalizáveis) =====
  const pub = client('pub');
  const PNG_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const pf = {
    v: 1, theme: { primary: '#1f55a6', bg: '#ffffff', text: '#14202e', headingFont: 'playfair', bodyFont: 'inter', radius: 'soft', width: 'normal' },
    seo: { title: 'Minha empresa', description: 'Descrição para o link' },
    blocks: [
      { id: 'b1', t: 'banner', title: 'Olá', subtitle: 'Sub', bgColor: '#1f55a6', showButton: true, buttonLabel: 'Fale', link: { kind: 'whatsapp', phone: '(85) 99999-1234', message: 'Oi' } },
      { id: 'b2', t: 'button', label: 'Site', link: { kind: 'link', url: 'meusite.com.br' } },
      { id: 'b3', t: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', caption: 'Vídeo' },
    ],
  };

  r = await pub('GET', '/portfolios'); assert.equal(r.status, 401);
  r = await u('GET', '/portfolios'); assert.equal(r.status, 200); assert.equal(r.body.limit, 2); assert.equal(r.body.portfolios.length, 0); assert.equal(r.body.userSlug, 'maria-teste');
  r = await u('POST', '/portfolios', { name: '  Minha   página ', data: pf }); assert.equal(r.status, 201, JSON.stringify(r.body));
  const pg1 = r.body.portfolio;
  assert.equal(pg1.name, 'Minha página'); assert.equal(pg1.isMain, true); assert.equal(pg1.published, false); assert.equal(pg1.slug, 'minha-pagina'); assert.equal(pg1.path, '/maria-teste');
  assert.equal(pg1.data.blocks[0].link.phone, '5585999991234'); assert.equal(pg1.data.blocks[1].link.url, 'https://meusite.com.br');
  ok('portfólio: 1ª página vira a principal e o endereço sai do nome do usuário (dominio/maria-teste)');

  // O documento é reconstruído no servidor: nada perigoso chega à página pública.
  r = await u('PATCH', `/portfolios/${pg1.id}`, { data: { ...pf, theme: { ...pf.theme, primary: 'red' }, blocks: [
    { id: 'x1', t: 'button', label: 'Mal', link: { kind: 'link', url: 'javascript:alert(1)' } },
    { id: 'x2', t: 'video', url: 'https://evil.example/video' },
    { id: 'x3', t: 'script', src: 'http://evil' },
    { id: 'x4', t: 'text', text: '<img src=x onerror=alert(1)>', extra: 'ignorado' },
    { id: 'x5', t: 'button', label: 'Mail', link: { kind: 'email', email: 'nao-e-email' } },
  ] } });
  assert.equal(r.status, 200);
  const cleaned = (await u('GET', `/portfolios/${pg1.id}`)).body.portfolio.data;
  assert.equal(cleaned.theme.primary, '#f2a33a'); assert.equal(cleaned.blocks.length, 4);
  assert.equal(cleaned.blocks[0].link.url, ''); assert.equal(cleaned.blocks[1].url, ''); assert.equal(cleaned.blocks[3].link.email, '');
  assert.equal(cleaned.blocks[2].text, '<img src=x onerror=alert(1)>'); assert.equal(cleaned.blocks[2].extra, undefined);
  r = await u('POST', '/portfolios', { name: 'Svg', data: { blocks: [{ t: 'image', src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }] } }); assert.equal(r.status, 400);
  r = await u('POST', '/portfolios', { name: 'Grande', data: { blocks: [{ t: 'image', src: `data:image/png;base64,${'A'.repeat(2_600_000)}` }] } }); assert.equal(r.status, 400);
  r = await u('POST', '/portfolios', { name: 'Gigante', data: { blocks: Array.from({ length: 4 }, () => ({ t: 'image', src: `data:image/png;base64,${'A'.repeat(2_400_000)}` })) } }); assert.equal(r.status, 413);
  r = await u('POST', '/portfolios', { name: 'Vazio', data: { blocks: 'oi' } }); assert.equal(r.status, 400);
  r = await u('POST', '/portfolios', { name: '   ' }); assert.equal(r.status, 400);
  r = await u('GET', '/portfolios'); assert.equal(r.body.portfolios.length, 1);
  ok('portfólio: link javascript:, vídeo de site desconhecido, bloco inválido, e-mail e cor inválidos são limpos; SVG e página gigante são recusados');

  await u('PATCH', `/portfolios/${pg1.id}`, { data: pf });
  r = await pub('GET', '/public/portfolio?u=maria-teste'); assert.equal(r.status, 404);
  r = await u('PATCH', `/portfolios/${pg1.id}`, { published: 'sim' }); assert.equal(r.status, 400);
  r = await u('PATCH', `/portfolios/${pg1.id}`, { published: true }); assert.equal(r.status, 200); assert.equal(r.body.portfolio.published, true);
  r = await pub('GET', '/public/portfolio?u=maria-teste');
  assert.equal(r.status, 200); assert.equal(r.body.owner.name, 'Maria Teste'); assert.equal(r.body.owner.email, undefined); assert.equal(r.body.page.data.blocks[0].title, 'Olá');
  assert.equal((await pub('GET', '/public/portfolio?u=MARIA-TESTE')).status, 200);
  assert.equal((await pub('GET', '/public/portfolio?u=maria-teste&p=minha-pagina')).status, 200);
  for (const bad of ['u=ninguem', 'u=api', 'u=portfolio', 'u=maria-teste&p=nao-existe', 'u=..%2Fetc', 'u=', '']) assert.equal((await pub('GET', `/public/portfolio?${bad}`)).status, 404, bad);
  ok('página pública (sem login): só aparece depois de publicada; endereço inexistente, reservado ou malformado dá 404');

  // Segunda página (prata = 2) e limites por plano
  r = await u('POST', '/portfolios', { name: 'Segunda' }); assert.equal(r.status, 201); const pg2 = r.body.portfolio;
  assert.equal(pg2.isMain, false); assert.equal(pg2.path, '/maria-teste/segunda'); assert.deepEqual(pg2.data.blocks, []);
  r = await u('POST', '/portfolios', { name: 'Terceira' }); assert.equal(r.status, 403); assert.equal(r.body.code, 'LIMIT_REACHED');
  r = await u('POST', `/portfolios/${pg1.id}/duplicate`); assert.equal(r.status, 403);
  ok('limite de páginas: prata = 2');
  r = await other('GET', '/portfolios'); assert.equal(r.body.limit, 1);
  await db.query("INSERT INTO users (kind, name, document, email, password_hash, trial_ends_at, portfolio_slug) VALUES ('PF', 'Outro', '99999999999', 'dup@t.com', 'x', now() + interval '3 days', 'empresa-ltda')");
  r = await other('POST', '/portfolios', { name: 'Institucional' }); assert.equal(r.status, 201);
  assert.equal(r.body.portfolio.path, '/empresa-ltda-2'); const otherPg = r.body.portfolio; // o endereço "empresa-ltda" já era de outro usuário
  r = await other('POST', '/portfolios', { name: 'Outra' }); assert.equal(r.status, 403);
  await db.query("DELETE FROM users WHERE email = 'dup@t.com'");
  ok('limite de páginas: bronze = 1; endereço igual ao de outro usuário ganha sufixo (empresa-ltda-2)');

  // Editar, endereço, página principal e exclusão
  r = await u('PATCH', `/portfolios/${pg2.id}`, { slug: 'Meus Trabalhos!' }); assert.equal(r.status, 200); assert.equal(r.body.portfolio.slug, 'meus-trabalhos'); assert.equal(r.body.portfolio.path, '/maria-teste/meus-trabalhos');
  r = await u('PATCH', `/portfolios/${pg2.id}`, { slug: 'minha-pagina' }); assert.equal(r.status, 409);
  r = await u('PATCH', `/portfolios/${pg2.id}`, { slug: '***' }); assert.equal(r.status, 400);
  r = await u('PATCH', `/portfolios/${pg2.id}`, {}); assert.equal(r.status, 400);
  r = await u('PATCH', `/portfolios/${pg2.id}`, { name: 'Trabalhos', data: pf, published: true }); assert.equal(r.status, 200); assert.equal(r.body.portfolio.name, 'Trabalhos');
  assert.equal((await pub('GET', '/public/portfolio?u=maria-teste&p=meus-trabalhos')).status, 200);
  assert.equal((await pub('GET', '/public/portfolio?u=maria-teste&p=segunda')).status, 404);

  r = await u('POST', `/portfolios/${pg2.id}/main`); assert.equal(r.status, 200);
  r = await u('GET', '/portfolios'); assert.equal(r.body.portfolios[0].id, pg2.id); assert.equal(r.body.portfolios[0].path, '/maria-teste'); assert.equal(r.body.portfolios.filter((p) => p.isMain).length, 1);
  assert.equal((await pub('GET', '/public/portfolio?u=maria-teste')).body.page.name, 'Trabalhos');
  r = await u('DELETE', `/portfolios/${pg2.id}`); assert.equal(r.status, 200);
  r = await u('GET', '/portfolios'); assert.equal(r.body.portfolios.length, 1); assert.equal(r.body.portfolios[0].id, pg1.id); assert.equal(r.body.portfolios[0].isMain, true);
  assert.equal((await pub('GET', '/public/portfolio?u=maria-teste&p=meus-trabalhos')).status, 404);
  ok('editar endereço (sem repetir), tornar principal, excluir (a mais antiga vira a principal) e o link antigo deixa de abrir');

  // Imagem de capa do link (WhatsApp/redes sociais não leem data URL)
  r = await u('POST', `/portfolios/${pg1.id}/duplicate`); assert.equal(r.status, 201); const cover = r.body.portfolio;
  r = await u('PATCH', `/portfolios/${cover.id}`, { published: true, data: { ...pf, blocks: [{ id: 'l1', t: 'logo', src: PNG_URL }, ...pf.blocks] } }); assert.equal(r.status, 200);
  const imgRes = await fetch(`http://localhost:${port}/api/public/portfolio/image?u=maria-teste&p=${cover.slug}`);
  assert.equal(imgRes.status, 200); assert.equal(imgRes.headers.get('content-type'), 'image/png');
  assert.deepEqual([...new Uint8Array(await imgRes.arrayBuffer()).slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal((await fetch(`http://localhost:${port}/api/public/portfolio/image?u=maria-teste&p=${pg1.slug}`)).status, 404); // sem imagem na página
  r = await u('DELETE', `/portfolios/${cover.id}`); assert.equal(r.status, 200);
  ok('miniatura do link: devolve a primeira imagem da página (PNG) e 404 quando não há imagem');

  // Um usuário não enxerga nem mexe nas páginas do outro
  r = await other('GET', `/portfolios/${pg1.id}`); assert.equal(r.status, 404);
  r = await other('PATCH', `/portfolios/${pg1.id}`, { name: 'Hack' }); assert.equal(r.status, 404);
  r = await other('PATCH', `/portfolios/${pg1.id}`, { published: false }); assert.equal(r.status, 404);
  r = await other('POST', `/portfolios/${pg1.id}/duplicate`); assert.equal(r.status, 404);
  r = await other('POST', `/portfolios/${pg1.id}/main`); assert.equal(r.status, 404);
  r = await other('DELETE', `/portfolios/${pg1.id}`); assert.equal(r.status, 404);
  assert.equal((await other('GET', '/portfolios')).body.portfolios.length, 1);
  assert.equal((await pub('GET', '/public/portfolio?u=empresa-ltda-2')).status, 404); // rascunho de outro usuário continua privado
  ok('um usuário não vê, edita nem exclui as páginas do outro');

  // Ouro: 7 páginas
  await db.query("UPDATE users SET plan = 'ouro' WHERE email = 'maria@t.com'");
  r = await u('GET', '/portfolios'); assert.equal(r.body.limit, 7);
  for (let i = 2; i <= 7; i++) { r = await u('POST', '/portfolios', { name: `Página ${i}` }); assert.equal(r.status, 201, `página ${i}`); }
  r = await u('POST', '/portfolios', { name: 'Oitava' }); assert.equal(r.status, 403); assert.equal(r.body.code, 'LIMIT_REACHED');
  assert.equal((await u('GET', '/portfolios')).body.portfolios.length, 7);
  await db.query("DELETE FROM portfolios WHERE user_id = (SELECT id FROM users WHERE email = 'maria@t.com') AND id <> $1", [pg1.id]);
  await db.query("UPDATE users SET plan = 'prata' WHERE email = 'maria@t.com'");
  ok('limite de páginas: ouro = 7');

  // ===== fim do teste grátis, bloqueio e pagamento =====
  const pending = await u('POST', '/schedules', { ...base, contactId: maria.id }); const blocked = pending.body.schedule;
  await db.query("UPDATE users SET trial_ends_at = now() - interval '1 second' WHERE email = 'maria@t.com'");
  r = await u('GET', '/schedules'); assert.equal(r.status, 402); assert.equal(r.body.code, 'PAYMENT_REQUIRED');
  assert.equal((await pub('GET', '/public/portfolio?u=maria-teste')).status, 404); ok('sem acesso ao sistema, a página pública do usuário deixa de abrir');
  sent.length = 0; await forceDue(blocked.id); await sleep(3500); assert.equal(sent.length, 0); ok('sem acesso: API bloqueada e nenhum envio automático sai');
  r = await u('POST', '/billing/checkout', { plan: 'prata' }); assert.equal(r.status, 200);
  const order = decodeURIComponent(r.body.url.split('o=')[1]);
  r = await u('POST', '/billing/confirm', { order_nsu: order, transaction_nsu: 't1', slug: 's1' }); assert.equal(r.status, 402);
  paid = true;
  r = await u('POST', '/billing/confirm', { order_nsu: order, transaction_nsu: 't1', slug: 's1' }); assert.equal(r.body.user.access.status, 'paid'); assert.equal(r.body.user.access.daysLeft, 30);
  r = await u('POST', '/billing/confirm', { order_nsu: order, transaction_nsu: 't1', slug: 's1' }); assert.equal(r.body.user.access.daysLeft, 30);
  r = await u('GET', '/schedules'); assert.equal(r.status, 200); ok('pagamento libera 30 dias (e confirmar de novo não soma dias)');
  assert.equal((await pub('GET', '/public/portfolio?u=maria-teste')).status, 200); ok('depois do pagamento a página pública volta a abrir');

  // ===== planos e períodos =====
  r = await client('anon')('GET', '/plans'); const P = Object.fromEntries(r.body.plans.map((x) => [x.id, x]));
  assert.deepEqual(P.bronze.prices, { mensal: 3490, semestral: 17450, anual: 31410 });
  assert.deepEqual(P.prata.prices, { mensal: 5490, semestral: 27450, anual: 49410 });
  assert.deepEqual(P.ouro.prices, { mensal: 6490, semestral: 32450, anual: 58410 });
  const lim = (x) => [x.instances, x.auditInstances, x.contracts, x.auditSend];
  assert.deepEqual([P.bronze.portfolios, P.prata.portfolios, P.ouro.portfolios], [1, 2, 7]);
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
  assert.equal(ana.name, 'Cliente Ana'); assert.equal(ana.unread, 1); assert.equal(ana.lastText, 'comprovante do pix'); assert.equal(ana.instanceId, aud1.id); assert.equal(r.body.chats[0].id, ana.id);
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
  // (importação do histórico, busca automática, mídia e nomes são testados mais abaixo)

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

  // ===== auditoria robusta: grupos, busca, não lidas, ordem, nomes, mídia, atualização automática =====
  const nowS = () => Math.floor(Date.now() / 1000);
  const AJ = '5585988887777@s.whatsapp.net'; const GJ = '120363000000000000@g.us';
  const getApi = (path, headers = {}, who = 'u') => fetch(`http://localhost:${port}/api${path}`, { headers: { Cookie: jar[who], ...headers } });
  const chatsOf = async (qs = '') => (await u('GET', `/audit/chats?limit=100${qs}`)).body;
  const msgsOf = async (id) => (await u('GET', `/audit/chats/${id}/messages?limit=100`)).body.messages;

  r = await u('GET', '/audit/chats?kind=groups'); assert.deepEqual(r.body.chats.map((c) => c.id), [grp.id]);
  r = await u('GET', '/audit/chats?kind=direct'); assert.ok(r.body.chats.length >= 2 && r.body.chats.every((c) => !c.isGroup)); assert.ok(r.body.chats.some((c) => c.id === ana.id));
  ok('filtro: só grupos, só contatos');

  // --- busca: acentos, várias palavras, frase, nomes
  await hook('contacts.upsert', [{ remoteJid: '5585900001111@s.whatsapp.net', pushName: 'Paulo Açaí' }]);
  r = await chatsOf('&q=acai'); assert.equal(r.chats.length, 1); assert.equal(r.chats[0].name, 'Paulo Açaí');
  r = await chatsOf(`&q=${encodeURIComponent('paulo numero 7')}`); assert.equal(r.chats.length, 1);
  r = await chatsOf(`&q=${encodeURIComponent('"numero 7"')}`); assert.equal(r.chats.length, 1);
  r = await chatsOf(`&q=${encodeURIComponent('"7 numero"')}`); assert.equal(r.chats.length, 0);
  r = await chatsOf(`&q=${encodeURIComponent('ana orcamento')}`); assert.equal(r.chats.length, 1); assert.equal(r.chats[0].id, ana.id);
  r = await chatsOf(`&q=${encodeURIComponent('ana zzzz')}`); assert.equal(r.chats.length, 0);
  r = await u('GET', `/audit/chats/${(await chatsOf('&q=acai')).chats[0].id}/search?q=${encodeURIComponent('mensagem 59')}`); assert.equal(r.body.total, 1);
  ok('busca por várias palavras (todas), frase entre aspas e nome sem acento');

  // --- não lidas por mensagem
  const dora = (id, text, dt = 0, extra = {}) => ({ key: { remoteJid: '5585955550000@s.whatsapp.net', fromMe: false, id, ...extra.key }, pushName: 'Dora', message: { conversation: text }, messageTimestamp: nowS() + dt, ...extra.rest });
  const unreadOf = async (name) => (await chatsOf()).chats.find((c) => c.name === name)?.unread;
  await hook('messages.upsert', dora('D1', 'oi', -30)); await hook('messages.upsert', dora('D2', 'tudo bem?', -20));
  assert.equal(await unreadOf('Dora'), 2);
  r = await chatsOf(); assert.equal(r.unreadTotal, r.chats.reduce((n, c) => n + c.unread, 0)); assert.equal(r.unreadChats, r.chats.filter((c) => c.unread).length);
  await hook('messages.update', [{ keyId: 'D1', status: 'READ' }]); assert.equal(await unreadOf('Dora'), 1); // o dono leu essa no celular
  const doraId = (await chatsOf()).chats.find((c) => c.name === 'Dora').id;
  r = await u('POST', `/audit/chats/${doraId}/read`); assert.equal(r.body.unread, 0); assert.equal(await unreadOf('Dora'), 0);
  await hook('messages.upsert', dora('D3', 'cheguei', -10)); assert.equal(await unreadOf('Dora'), 1);
  await hook('messages.upsert', { key: { remoteJid: '5585955550000@s.whatsapp.net', fromMe: true, id: 'D4' }, message: { conversation: 'já te respondo' }, messageTimestamp: nowS() }); assert.equal(await unreadOf('Dora'), 0); // o dono respondeu pelo celular
  await hook('messages.upsert', dora('D5', 'chegou atrasada', -5)); assert.equal(await unreadOf('Dora'), 0); // anterior à resposta do dono: já foi vista
  await hook('messages.upsert', dora('D6', 'mensagem antiga', -3 * 3600)); assert.equal(await unreadOf('Dora'), 0); // histórico (3 h atrás) não conta como nova
  await hook('messages.upsert', dora('D7', 'agora sim', 5)); assert.equal(await unreadOf('Dora'), 1);
  r = await chatsOf('&unread=1'); assert.ok(r.chats.some((c) => c.name === 'Dora')); await u('POST', `/audit/chats/${doraId}/read`); r = await chatsOf('&unread=1'); assert.ok(!r.chats.some((c) => c.name === 'Dora'));
  ok('não lidas: abrir a conversa, responder pelo celular, "lida" do WhatsApp, mensagem atrasada e histórico');

  // --- ordem
  const ord = (id, ts, text, fromMe = false) => ({ key: { remoteJid: '5585933330000@s.whatsapp.net', fromMe, id }, pushName: 'Ordem', message: { conversation: text }, messageTimestamp: ts });
  await hook('messages.upsert', ord('O2', nowS() - 100, 'segunda')); await hook('messages.upsert', ord('O1', nowS() - 300, 'primeira')); await hook('messages.upsert', ord('O3', nowS() + 3 * 86400, 'do futuro'));
  const ordem = (await chatsOf()).chats.find((c) => c.name === 'Ordem');
  assert.deepEqual((await msgsOf(ordem.id)).map((m) => m.body), ['primeira', 'segunda', 'do futuro']);
  assert.ok(ordem.lastMessageAt <= Date.now() + 70_000); assert.equal(ordem.lastText, 'do futuro');
  r = await chatsOf(); const times = r.chats.map((c) => c.lastMessageAt); assert.deepEqual(times, [...times].sort((a, b) => b - a));
  ok('ordem: lista pela mensagem mais recente, conversa em ordem de horário (mesmo se chegou atrasada) e data futura não gruda no topo');

  // --- nomes
  await hook('messages.upsert', { key: { remoteJid: '5585944443333@s.whatsapp.net', fromMe: false, id: 'NN1' }, message: { conversation: 'sem nome' }, messageTimestamp: nowS() });
  assert.equal((await chatsOf()).chats.find((c) => c.phone === '5585944443333').name, null);
  await hook('contacts.upsert', [{ remoteJid: '5585944443333@s.whatsapp.net', pushName: 'Maria Souza' }]);
  assert.equal((await chatsOf('&q=souza')).chats[0].name, 'Maria Souza');
  await hook('chats.upsert', [{ id: GJ, name: 'Equipe Vendas' }]); r = await chatsOf('&kind=groups&q=vendas'); assert.equal(r.chats[0].name, 'Equipe Vendas');
  await hook('messages.upsert', { key: { remoteJid: GJ, fromMe: false, id: 'G2', participant: '5585966660000@s.whatsapp.net' }, message: { conversation: 'oi time' }, messageTimestamp: nowS() });
  let gm = (await msgsOf(grp.id)).find((m) => m.body === 'oi time'); assert.equal(gm.sender, null); assert.equal(gm.senderPhone, '5585966660000');
  await hook('contacts.upsert', [{ remoteJid: '5585966660000@s.whatsapp.net', pushName: 'Carlos' }]);
  gm = (await msgsOf(grp.id)).find((m) => m.body === 'oi time'); assert.equal(gm.sender, 'Carlos');
  ok('nomes: contato, assunto do grupo e quem falou no grupo (aparece o nome em vez do número)');

  // --- mensagem editada
  await hook('messages.upsert', { key: { remoteJid: AJ, fromMe: false, id: 'ED1' }, pushName: 'Cliente Ana', message: { conversation: 'valor errado 100' }, messageTimestamp: nowS() });
  await hook('messages.upsert', { key: { remoteJid: AJ, fromMe: false, id: 'ED2' }, message: { protocolMessage: { type: 14, key: { id: 'ED1' }, editedMessage: { conversation: 'valor certo 200' } } }, messageTimestamp: nowS() });
  assert.ok((await msgsOf(ana.id)).some((m) => m.body === 'valor certo 200')); assert.equal((await u('GET', `/audit/chats/${ana.id}/search?q=certo`)).body.total, 1);
  ok('mensagem editada atualiza o texto e a busca');

  // --- canal de atualização de segurança (/updates)
  const cur = (await u('GET', '/audit/chats?limit=1')).body.cursor;
  await hook('messages.upsert', { key: { remoteJid: AJ, fromMe: false, id: 'UPD1' }, pushName: 'Cliente Ana', message: { conversation: 'chegou pelo canal de segurança' }, messageTimestamp: nowS() });
  r = await u('GET', `/audit/updates?after=${cur}`); assert.equal(r.body.messages.length, 1); assert.equal(r.body.messages[0].body, 'chegou pelo canal de segurança'); assert.equal(r.body.chats[0].id, ana.id); assert.ok(r.body.cursor > cur);
  r = await u('GET', `/audit/updates?after=${r.body.cursor}`); assert.equal(r.body.messages.length, 0);
  r = await other('GET', `/audit/updates?after=${cur}`); assert.equal(r.body.messages.length, 0);
  ok('/updates devolve só o que chegou depois (e só do dono): a tela se atualiza mesmo se o tempo real for barrado');

  // --- mídia
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const media = (id, node, rest = {}) => ({ key: { remoteJid: AJ, fromMe: false, id }, pushName: 'Cliente Ana', message: { ...node, ...rest }, messageTimestamp: nowS() });
  await hook('messages.upsert', media('IMG1', { imageMessage: { mimetype: 'image/png', caption: 'foto do comprovante', jpegThumbnail: { 0: 255, 1: 216, 2: 255, 3: 217 } } }, { base64: PNG.toString('base64') }));
  let im = (await msgsOf(ana.id)).find((m) => m.body === 'foto do comprovante'); assert.equal(im.type, 'image'); assert.deepEqual([im.media.mime, im.media.thumb], ['image/png', true]);
  let f = await getApi(`/audit/messages/${im.id}/media`); assert.equal(f.status, 200); assert.equal(f.headers.get('content-type'), 'image/png'); assert.match(f.headers.get('content-disposition'), /^inline/); assert.match(f.headers.get('content-security-policy'), /sandbox/);
  assert.ok(Buffer.from(await f.arrayBuffer()).equals(PNG));
  assert.equal((await chatsOf(`&q=${encodeURIComponent('comprovante')}`)).chats.some((c) => c.id === ana.id), true);
  fake.media.AUD1 = { base64: Buffer.from('OggS-audio-de-teste').toString('base64'), mimetype: 'audio/ogg; codecs=opus' };
  await hook('messages.upsert', media('AUD1', { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 7, ptt: true } }));
  const au = (await msgsOf(ana.id)).find((m) => m.type === 'audio'); assert.equal(au.media.seconds, 7);
  await eventually(async () => (await db.query('SELECT 1 FROM audit_media WHERE message_id = $1', [au.id])).rowCount === 1, 'áudio baixado sozinho da Evolution');
  f = await getApi(`/audit/messages/${au.id}/media`); assert.equal(f.status, 200); assert.equal(f.headers.get('content-type'), 'audio/ogg; codecs=opus'); assert.equal(await f.text(), 'OggS-audio-de-teste');
  fake.media.VID1 = { base64: Buffer.from('0123456789ABCDEF').toString('base64'), mimetype: 'video/mp4' };
  await hook('messages.upsert', media('VID1', { videoMessage: { mimetype: 'video/mp4', caption: 'vídeo da obra', seconds: 3 } }));
  const vi = (await msgsOf(ana.id)).find((m) => m.type === 'video'); assert.equal((await db.query('SELECT 1 FROM audit_media WHERE message_id = $1', [vi.id])).rowCount, 0); // vídeo só baixa quando alguém abre
  f = await getApi(`/audit/messages/${vi.id}/media`, { Range: 'bytes=2-5' }); assert.equal(f.status, 206); assert.equal(f.headers.get('content-range'), 'bytes 2-5/16'); assert.equal(await f.text(), '2345');
  f = await getApi(`/audit/messages/${vi.id}/media`, { Range: 'bytes=-4' }); assert.equal(f.status, 206); assert.equal(await f.text(), 'CDEF');
  f = await getApi(`/audit/messages/${vi.id}/media`, { Range: 'bytes=99-120' }); assert.equal(f.status, 416);
  f = await getApi(`/audit/messages/${vi.id}/media`); assert.equal(f.status, 200); assert.equal(f.headers.get('content-length'), '16');
  await hook('messages.upsert', media('GONE1', { imageMessage: { mimetype: 'image/jpeg', jpegThumbnail: 'AAAA' } }));
  const lost = (await msgsOf(ana.id)).filter((m) => m.type === 'image' && m.id !== im.id).at(-1); f = await getApi(`/audit/messages/${lost.id}/media`); assert.equal(f.status, 200); assert.equal(f.headers.get('content-type'), 'image/jpeg'); // arquivo sumiu: mostra a miniatura
  await hook('messages.upsert', media('GONE2', { videoMessage: { mimetype: 'video/mp4' } })); const gone2 = (await msgsOf(ana.id)).filter((m) => m.type === 'video' && m.id !== vi.id).at(-1); f = await getApi(`/audit/messages/${gone2.id}/media`); assert.equal(f.status, 404);
  fake.media.SVG1 = { base64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64'), mimetype: 'image/svg+xml' };
  await hook('messages.upsert', media('SVG1', { imageMessage: { mimetype: 'image/svg+xml' } })); await sleep(1200);
  const svg = (await msgsOf(ana.id)).find((m) => m.media?.mime === 'image/svg+xml'); f = await getApi(`/audit/messages/${svg.id}/media`); assert.equal(f.headers.get('content-type'), 'application/octet-stream'); assert.match(f.headers.get('content-disposition'), /^attachment/);
  await hook('messages.upsert', media('DOC1', { documentMessage: { mimetype: 'application/pdf', fileName: 'contrato final.pdf' } }, { base64: Buffer.from('%PDF-1.4 teste').toString('base64') }));
  const doc1 = (await msgsOf(ana.id)).find((m) => m.type === 'document'); assert.equal(doc1.body, 'contrato final.pdf'); f = await getApi(`/audit/messages/${doc1.id}/media`); assert.match(f.headers.get('content-disposition'), /^attachment; filename="contrato final.pdf"/); assert.equal(f.headers.get('content-type'), 'application/octet-stream');
  assert.equal((await getApi(`/audit/messages/${im.id}/media`, {}, 'other')).status, 404); assert.equal((await fetch(`http://localhost:${port}/api/audit/messages/${im.id}/media`)).status, 401);
  ok('mídia: foto/áudio/vídeo/documento guardados e servidos (com avançar no vídeo), miniatura de reserva, SVG/documento só para baixar, dono apenas');

  // --- atualização automática: aparece sozinho, sem webhook e sem clicar em importar
  fake.groups = [{ id: '120363111111111111@g.us', subject: 'Grupo Automático' }];
  const AUTO = '5585922224444@s.whatsapp.net'; const AUTOG = '120363111111111111@g.us';
  const rec = (jid, id, text, extra = {}) => ({ key: { remoteJid: jid, fromMe: false, id, ...extra.key }, pushName: extra.pushName, message: { conversation: text }, messageTimestamp: nowS() });
  fake.chats = [{ remoteJid: AUTO, name: 'Cliente Automático', updatedAt: new Date().toISOString() }, { remoteJid: AUTOG, updatedAt: new Date().toISOString() }];
  fake.messages[AUTO] = [rec(AUTO, 'AUTO1', 'olá, apareci sozinho', { pushName: 'Cliente Automático' })];
  fake.messages[AUTOG] = [rec(AUTOG, 'AUTOG1', 'mensagem automática do grupo', { key: { participant: '5585977771111@s.whatsapp.net' }, pushName: 'Zé' })];
  const auto = await eventually(async () => (await chatsOf()).chats.find((c) => c.name === 'Cliente Automático'), 'conversa nova aparecer sozinha');
  assert.equal(auto.unread, 1); assert.equal((await msgsOf(auto.id))[0].body, 'olá, apareci sozinho');
  const autoG = await eventually(async () => (await chatsOf('&kind=groups')).chats.find((c) => c.name === 'Grupo Automático'), 'grupo novo com nome');
  assert.equal((await msgsOf(autoG.id))[0].sender, 'Zé');
  fake.messages[AUTO].push(rec(AUTO, 'AUTO2', 'segunda mensagem sozinha')); fake.chats[0].updatedAt = new Date().toISOString();
  await eventually(async () => (await msgsOf(auto.id)).length === 2 && (await chatsOf()).chats.find((c) => c.id === auto.id).unread === 2, 'mensagem nova buscada sozinha');
  fake.ascending = true; fake.messages[AUTO].push(rec(AUTO, 'AUTO3', 'terceira (Evolution em ordem crescente)')); fake.chats[0].updatedAt = new Date().toISOString();
  await eventually(async () => (await msgsOf(auto.id)).some((m) => m.body.startsWith('terceira')), 'busca também funciona se a Evolution devolve do mais antigo ao mais novo'); fake.ascending = false;
  ok('atualização automática: conversas, grupos (com nome) e mensagens novas aparecem sozinhos, contadas como não lidas');

  // --- importar histórico (botão "Sincronizar agora") e primeira busca = tudo lido
  const OLD = '5585911112222@s.whatsapp.net';
  fake.chats.push({ remoteJid: OLD, name: 'Histórico Hugo', updatedAt: new Date(Date.now() - 30 * 86400000).toISOString() }); // 30 dias atrás: ainda dentro dos 60 dias guardados
  fake.messages[OLD] = [
    { key: { remoteJid: OLD, fromMe: false, id: 'HIST1' }, pushName: 'Histórico Hugo', message: { conversation: 'mensagem antiga 1' }, messageTimestamp: nowS() - 30 * 86400 },
    { key: { remoteJid: OLD, fromMe: true, id: 'HIST2' }, message: { conversation: 'mensagem antiga 2' }, messageTimestamp: nowS() - 30 * 86400 + 100 },
  ];
  r = await u('POST', `/audit/instances/${aud1.id}/sync`); assert.equal(r.status, 200); assert.equal(r.body.started || r.body.running, true);
  const hugo = await eventually(async () => (await chatsOf('&q=Hugo')).chats.find((c) => c.instanceId === aud1.id), 'histórico importado');
  assert.equal(hugo.unread, 0); assert.deepEqual((await msgsOf(hugo.id)).map((m) => m.body), ['mensagem antiga 1', 'mensagem antiga 2']);
  r = await u('GET', '/audit/instances'); const ai = r.body.instances.find((i) => i.id === aud1.id); assert.ok(ai.lastSyncAt > Date.now() - 60_000); assert.ok('sync' in ai);
  ok('"Sincronizar agora" importa o histórico em segundo plano (histórico entra como lido) e a conexão mostra a última sincronização');
  fake.chats = []; fake.messages = {}; fake.groups = [];

  // ===== auditoria: filtro de 7, 30 e 60 dias e limpeza automática de mensagens com mais de 60 dias =====
  const DAYS = 86400;
  const mariaId = (await db.query("SELECT id FROM users WHERE email = 'maria@t.com'")).rows[0].id;
  const utcAgo = (d) => `((now() AT TIME ZONE 'UTC') - interval '${d} days')`;

  // histórico com mais de 60 dias NÃO é importado (nem cria conversa), nem pela busca automática nem pelo webhook
  const ANCIENT = '5585900009999@s.whatsapp.net';
  fake.chats.push({ remoteJid: ANCIENT, name: 'Muito Antigo', updatedAt: new Date(Date.now() - 90 * DAYS * 1000).toISOString() });
  fake.messages[ANCIENT] = [{ key: { remoteJid: ANCIENT, fromMe: false, id: 'ANC1' }, pushName: 'Muito Antigo', message: { conversation: 'faz muito tempo' }, messageTimestamp: nowS() - 90 * DAYS }];
  r = await u('POST', `/audit/instances/${aud1.id}/sync`); assert.equal(r.status, 200);
  await eventually(async () => { const x = (await u('GET', '/audit/instances')).body.instances.find((i) => i.id === aud1.id); return x?.sync && !x.sync.running; }, 'sincronização terminar');
  assert.equal((await chatsOf('&q=Antigo&days=60')).chats.length, 0);
  assert.equal((await hook('messages.upsert', { key: { remoteJid: '5585900008888@s.whatsapp.net', fromMe: false, id: 'ANC2' }, pushName: 'Webhook Antigo', message: { conversation: 'mensagem velha' }, messageTimestamp: nowS() - 70 * DAYS })).status, 200);
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_chats WHERE name = 'Webhook Antigo'")).rows[0].n, 0);
  assert.equal((await hook('messages.upsert', { key: { remoteJid: '5585900008888@s.whatsapp.net', fromMe: false, id: 'ANC3' }, pushName: 'Webhook Novo', message: { conversation: 'mensagem de agora' }, messageTimestamp: nowS() })).status, 200);
  assert.equal((await chatsOf('&q=Webhook Novo')).chats.length, 1);
  fake.chats = []; fake.messages = {};
  ok('mensagens com mais de 60 dias não são guardadas (nem pelo histórico, nem pelo webhook); as de agora entram normalmente');

  // conversas em datas diferentes (3, 20, 45 e 70 dias atrás) para testar o filtro e a limpeza
  const seeded = [];
  const mkChat = async (n, name, { created = '0 minutes', note = '', unread = 0, msgs }) => {
    const last = Math.min(...msgs.map((m) => m.d));
    const c = (await db.query(`INSERT INTO audit_chats (user_id, instance_id, jid, is_group, name, name_search, phone, note, last_message_at, last_text, unread, created_at) VALUES ($1, $2, $3, false, $4, $5, '', $6, ${utcAgo(last)}, '', $7, (now() AT TIME ZONE 'UTC') - $8::interval) RETURNING id`, [mariaId, aud1.id, `55859000${n}@s.whatsapp.net`, name, name.toLowerCase(), note, unread, created])).rows[0].id;
    seeded.push(c);
    const ids = [];
    for (const [i, m] of msgs.entries()) ids.push((await db.query(`INSERT INTO audit_messages (chat_id, external_id, from_me, type, body, search, ts) VALUES ($1, $2, $3, 'text', $4, $5, ${utcAgo(m.d)}) RETURNING id`, [c, `RET-${n}-${i}`, Boolean(m.me), m.body, m.body.toLowerCase()])).rows[0].id);
    return { id: c, msgIds: ids };
  };
  const c3 = await mkChat('1001', 'Ret Três dias', { msgs: [{ d: 3, body: 'Tres dias atras' }] });
  const c20 = await mkChat('1002', 'Ret Vinte dias', { msgs: [{ d: 20, body: 'Vinte dias atras' }] });
  const c45 = await mkChat('1003', 'Ret Quarenta dias', { msgs: [{ d: 45, body: 'Quarenta e cinco dias atras' }] });
  const c70 = await mkChat('1004', 'Ret Setenta dias', { created: '5 hours', msgs: [{ d: 70, body: 'Setenta dias atras' }] });
  const mix = await mkChat('1005', 'Ret Mista', { unread: 2, msgs: [{ d: 70, body: 'Mista 70 dias' }, { d: 45, body: 'Mista 45 dias', me: true }, { d: 20, body: 'Mista 20 dias', me: true }, { d: 3, body: 'Mista 3 dias' }] });
  const oldNote = await mkChat('1006', 'Ret Velha com nota', { created: '5 hours', note: 'cliente importante', msgs: [{ d: 80, body: 'Nota 80 dias' }] });
  const oldNone = await mkChat('1007', 'Ret Velha sem nada', { created: '5 hours', msgs: [{ d: 80, body: 'Nada 80 dias' }] });
  await db.query('INSERT INTO audit_media (message_id, mime, size, data) VALUES ($1, $2, 3, $3)', [c70.msgIds[0], 'image/jpeg', Buffer.from([1, 2, 3])]);

  const names = async (qs) => (await chatsOf(qs)).chats.map((c) => c.name);
  let nm = await names('&days=7'); assert.ok(nm.includes('Ret Três dias') && nm.includes('Ret Mista') && !nm.includes('Ret Vinte dias') && !nm.includes('Ret Quarenta dias'));
  nm = await names('&days=30'); assert.ok(nm.includes('Ret Vinte dias') && !nm.includes('Ret Quarenta dias'));
  nm = await names('&days=60'); assert.ok(nm.includes('Ret Quarenta dias') && !nm.includes('Ret Setenta dias') && !nm.includes('Ret Velha com nota'));
  for (const bad of ['', '&days=999', '&days=abc', '&days=0']) { nm = await names(bad); assert.ok(nm.includes('Ret Quarenta dias') && !nm.includes('Ret Setenta dias'), `days inválido ${bad}`); } // valor inválido = 60 dias
  ok('lista de conversas filtra por 7, 30 e 60 dias (padrão e valores inválidos = 60); o que passou de 60 dias já nem aparece');

  const bodies = async (id, qs = '') => (await u('GET', `/audit/chats/${id}/messages?limit=100${qs}`)).body.messages.map((m) => m.body);
  assert.deepEqual(await bodies(mix.id), ['Mista 45 dias', 'Mista 20 dias', 'Mista 3 dias']);
  assert.deepEqual(await bodies(mix.id, '&days=30'), ['Mista 20 dias', 'Mista 3 dias']);
  assert.deepEqual(await bodies(mix.id, '&days=7'), ['Mista 3 dias']);
  r = await u('GET', `/audit/chats/${mix.id}/messages?limit=100&days=30&before=${Date.now()}_999999`); assert.deepEqual(r.body.messages.map((m) => m.body), ['Mista 20 dias', 'Mista 3 dias']); assert.equal(r.body.hasOlder, false);
  r = await u('GET', `/audit/chats/${mix.id}/messages?around=${mix.msgIds[1]}&days=30`); assert.equal(r.status, 404); // a mensagem de 45 dias está fora do filtro de 30
  r = await u('GET', `/audit/chats/${mix.id}/messages?around=${mix.msgIds[1]}&days=60`); assert.equal(r.status, 200); assert.deepEqual(r.body.messages.map((m) => m.body), ['Mista 45 dias', 'Mista 20 dias', 'Mista 3 dias']);
  assert.equal((await u('GET', `/audit/chats/${mix.id}/search?q=mista&days=7`)).body.total, 1);
  assert.equal((await u('GET', `/audit/chats/${mix.id}/search?q=mista&days=30`)).body.total, 2);
  assert.equal((await u('GET', `/audit/chats/${mix.id}/search?q=mista`)).body.total, 3);
  assert.ok(!(await names('&q=Mista 45&days=7')).includes('Ret Mista')); assert.ok((await names('&q=Mista 45&days=60')).includes('Ret Mista'));
  ok('mensagens, rolagem para cima, "ir até a mensagem" e busca respeitam o filtro de 7, 30 e 60 dias');

  // limpeza automática (a mesma rotina que o servidor roda de hora em hora)
  (await import('../server/config.js')).config.databaseUrl = dbUrl.toString(); // este processo usa o banco temporário do teste
  const { purgeOldAuditMessages } = await import('../server/services/maintenance.js');
  const testPrisma = (await import('../server/prisma.js')).prisma;
  await purgeOldAuditMessages();
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_messages WHERE ts < (now() AT TIME ZONE 'UTC') - interval '60 days'")).rows[0].n, 0);
  assert.deepEqual((await db.query('SELECT body FROM audit_messages WHERE chat_id = $1 ORDER BY ts', [mix.id])).rows.map((x) => x.body), ['Mista 45 dias', 'Mista 20 dias', 'Mista 3 dias']);
  assert.equal((await db.query('SELECT unread FROM audit_chats WHERE id = $1', [mix.id])).rows[0].unread, 1); // a mensagem não lida de 70 dias saiu, sobra a de 3 dias
  assert.equal((await db.query('SELECT count(*)::int n FROM audit_media WHERE message_id = $1', [c70.msgIds[0]])).rows[0].n, 0); // a mídia sai junto
  const alive = (await db.query('SELECT name FROM audit_chats WHERE id = ANY($1)', [seeded])).rows.map((x) => x.name).sort();
  assert.deepEqual(alive, ['Ret Mista', 'Ret Quarenta dias', 'Ret Três dias', 'Ret Velha com nota', 'Ret Vinte dias']); // vazias sem anotação/etiqueta saem; com anotação ficam
  assert.equal((await db.query('SELECT count(*)::int n FROM audit_messages WHERE chat_id = $1', [oldNote.id])).rows[0].n, 0);
  await testPrisma.$disconnect();
  await db.query('DELETE FROM audit_chats WHERE id = ANY($1)', [seeded]); // limpa o cenário deste teste
  void [c3, c20, c45, oldNone];
  ok('limpeza automática: apaga mensagens com mais de 60 dias (e as mídias), acerta as não lidas e remove conversas vazias sem anotação');

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

  // ===== admin: planos editáveis (valores e limites vêm do banco, não do .env) =====
  r = await u('GET', '/admin/plans'); assert.equal(r.status, 403); r = await u('PUT', '/admin/plans/bronze', {}); assert.equal(r.status, 403);
  r = await a('GET', '/admin/plans'); assert.equal(r.status, 200); assert.deepEqual(r.body.plans.map((x) => x.id), ['bronze', 'prata', 'ouro']);
  assert.equal(r.body.plans[0].priceCents, 3490); assert.equal(r.body.plans[0].prices.semestral, 17450); assert.equal(r.body.plans[2].auditSend, true); assert.ok(r.body.plans.every((x) => Number.isInteger(x.userCount)));
  assert.equal((await db.query('SELECT count(*)::int n FROM plan_settings')).rows[0].n, 3); // criados no banco na primeira execução
  assert.equal((await other('GET', '/contracts')).body.limit, 2);
  const planBody = { priceCents: 4990, instances: 2, auditInstances: 2, contracts: 5, portfolios: 3, auditSend: true };
  r = await a('PUT', '/admin/plans/bronze', planBody); assert.equal(r.status, 200, JSON.stringify(r.body));
  const b2 = r.body.plans.find((x) => x.id === 'bronze'); assert.equal(b2.priceCents, 4990); assert.deepEqual(b2.prices, { mensal: 4990, semestral: 24950, anual: 44910 }); assert.deepEqual([b2.instances, b2.auditInstances, b2.contracts, b2.portfolios, b2.auditSend], [2, 2, 5, 3, true]);
  assert.equal((await db.query("SELECT price_cents, contracts FROM plan_settings WHERE plan = 'bronze'")).rows[0].contracts, 5);
  r = await client('anon')('GET', '/plans'); assert.equal(r.body.plans.find((x) => x.id === 'bronze').prices.mensal, 4990); // a tela de planos já mostra o novo valor
  assert.equal((await other('GET', '/contracts')).body.limit, 5); // o limite vale na hora
  r = await other('GET', '/auth/me'); assert.deepEqual([r.body.user.limits.instances, r.body.user.limits.auditInstances, r.body.user.limits.portfolios, r.body.user.limits.auditSend], [2, 2, 3, true]);
  r = await other('POST', '/billing/checkout', { plan: 'bronze', period: 'anual' }); assert.equal(orders[decodeURIComponent(r.body.url.split('o=')[1])], 44910); // o pagamento cobra o valor novo (9 mensalidades)
  for (const bad of [{ priceCents: 50 }, { priceCents: 'abc' }, { priceCents: 49.9 }, { contracts: -1 }, { instances: 5000 }, { portfolios: '1.5' }, { auditSend: 'sim' }]) {
    r = await a('PUT', '/admin/plans/bronze', { ...planBody, ...bad }); assert.equal(r.status, 400, JSON.stringify(bad));
  }
  r = await a('PUT', '/admin/plans/diamante', planBody); assert.equal(r.status, 404);
  r = await a('PUT', '/admin/plans/bronze', { priceCents: 3490, instances: 1, auditInstances: 1, contracts: 2, portfolios: 1, auditSend: false }); assert.equal(r.status, 200); // volta ao padrão
  assert.equal((await other('GET', '/contracts')).body.limit, 2);
  ok('admin vê e altera valor e limites de cada plano; vale na hora para limites, tela de planos e pagamento; entradas inválidas são recusadas');

  // ===== perfil, código PIN e recuperação pelo WhatsApp do admin =====
  // (cliente com vários cookies, porque o PIN usa um cookie à parte)
  const mclient = () => {
    const jarMap = new Map();
    return async (method, url, body) => {
      const res = await fetch(`http://localhost:${port}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: [...jarMap].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined });
      for (const c of res.headers.getSetCookie()) { const kv = c.split(';')[0]; const i = kv.indexOf('='); const k = kv.slice(0, i); const v = kv.slice(i + 1); if (!v) jarMap.delete(k); else jarMap.set(k, v); }
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
  };
  const login = async (who, identifier, password) => { const x = await who('POST', '/auth/login', { identifier, password }); assert.equal(x.status, 200, JSON.stringify(x.body)); return x; };
  const prevEvo = evoState;
  const p = mclient(); const p2 = mclient(); const anon2 = mclient();
  await login(p, 'maria@t.com', 'senha12345'); await login(p2, 'maria@t.com', 'senha12345');

  // --- perfil
  r = await p('GET', '/auth/me'); assert.equal(r.body.user.pin.enabled, false); assert.equal(r.body.pinUnlockedUntil, null);
  r = await p('PATCH', '/auth/profile', { name: 'Maria T. Souza' }); assert.equal(r.status, 200); assert.equal(r.body.user.name, 'Maria T. Souza');
  r = await p('PATCH', '/auth/profile', {}); assert.equal(r.status, 400);
  r = await p('PATCH', '/auth/profile', { name: 'Ma' }); assert.equal(r.status, 400);
  r = await p('PATCH', '/auth/profile', { email: 'maria.nova@t.com' }); assert.equal(r.status, 403); assert.equal(r.body.code, 'PASSWORD_WRONG'); // trocar e-mail pede a senha atual
  r = await p('PATCH', '/auth/profile', { email: 'isso-nao-e-email', currentPassword: 'senha12345' }); assert.equal(r.status, 400);
  r = await p('PATCH', '/auth/profile', { email: 'e@t.com', currentPassword: 'senha12345' }); assert.equal(r.status, 409); // e-mail de outra conta
  r = await p('PATCH', '/auth/profile', { newPassword: 'curta', currentPassword: 'senha12345' }); assert.equal(r.status, 400);
  r = await p('PATCH', '/auth/profile', { newPassword: 'novaSenha456', currentPassword: 'errada!!' }); assert.equal(r.status, 403);
  r = await p('PATCH', '/auth/profile', { email: 'maria.nova@t.com', phone: '(85) 98888-0000', newPassword: 'novaSenha456', currentPassword: 'senha12345' }); assert.equal(r.status, 200);
  assert.equal(r.body.user.email, 'maria.nova@t.com'); assert.equal(r.body.user.phone, '85988880000'); assert.equal(JSON.stringify(r.body).includes('passwordHash'), false);
  assert.equal((await anon2('POST', '/auth/login', { identifier: 'maria@t.com', password: 'senha12345' })).status, 401); // e-mail e senha antigos não valem mais
  await login(anon2, 'maria.nova@t.com', 'novaSenha456');
  r = await p('PATCH', '/auth/profile', { email: 'maria@t.com', phone: '(85) 99999-1234', newPassword: 'senha12345', currentPassword: 'novaSenha456' }); assert.equal(r.status, 200); // volta ao original
  ok('perfil: troca nome; e-mail, WhatsApp e senha pedem a senha atual; e-mail repetido é recusado');

  // --- criar PIN e escolher as abas
  r = await p('PUT', '/auth/pin', { pin: '12', tabs: ['auditoria'] }); assert.equal(r.status, 400);
  r = await p('PUT', '/auth/pin', { pin: '12ab', tabs: ['auditoria'] }); assert.equal(r.status, 400);
  r = await p('PUT', '/auth/pin', { pin: '1234', tabs: [] }); assert.equal(r.status, 400);
  r = await p('PUT', '/auth/pin', { pin: '1234', tabs: ['nada'] }); assert.equal(r.status, 400);
  r = await p('PUT', '/auth/pin', { tabs: ['auditoria'] }); assert.equal(r.status, 400); // sem PIN ainda: precisa digitar um
  r = await p('PUT', '/auth/pin', { pin: '1234', tabs: ['auditoria', 'contratos', 'clientes'] }); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.user.pin, { enabled: true, tabs: ['clientes', 'contratos', 'auditoria'] }); assert.ok(r.body.pinUnlockedUntil > Date.now());
  assert.equal(/pin_?hash/i.test(JSON.stringify(r.body)), false); assert.equal(/pin_?hash/i.test(JSON.stringify((await p('GET', '/auth/me')).body)), false); // o hash do PIN nunca sai do servidor
  assert.ok(/^\$2[aby]\$/.test((await db.query("SELECT pin_hash FROM users WHERE email = 'maria@t.com'")).rows[0].pin_hash)); // guardado com hash
  ok('criar código PIN com as abas que serão protegidas (validado; o PIN é guardado só com hash)');

  // --- outro navegador (sessão nova) começa travado: APIs exclusivas da aba respondem 423
  r = await p2('GET', '/auth/me'); assert.equal(r.body.user.pin.enabled, true); assert.equal(r.body.pinUnlockedUntil, null);
  r = await p2('GET', '/audit/chats'); assert.equal(r.status, 423); assert.equal(r.body.code, 'PIN_REQUIRED');
  r = await p2('GET', '/audit/instances'); assert.equal(r.status, 423);
  r = await p2('GET', '/contracts'); assert.equal(r.status, 423);
  r = await p2('GET', '/portfolios'); assert.equal(r.status, 200); // aba sem PIN continua livre
  r = await p2('GET', '/contacts'); assert.equal(r.status, 200); // "clientes" é protegida só na tela (a API também serve as cobranças)
  r = await p('GET', '/audit/chats'); assert.equal(r.status, 200); // quem acabou de criar o PIN já está liberado
  r = await p2('POST', '/auth/pin/verify', { pin: '0000' }); assert.equal(r.status, 403); assert.equal(r.body.code, 'PIN_WRONG');
  r = await p2('POST', '/auth/pin/verify', { pin: 'abcd' }); assert.equal(r.status, 403);
  r = await p2('POST', '/auth/pin/verify', { pin: '1234' }); assert.equal(r.status, 200); assert.ok(r.body.pinUnlockedUntil > Date.now() + 25 * 60_000); // vale por 30 minutos
  assert.equal((await p2('GET', '/audit/chats')).status, 200); assert.equal((await p2('GET', '/contracts')).status, 200);
  assert.ok((await p2('GET', '/auth/me')).body.pinUnlockedUntil > Date.now());
  r = await p2('POST', '/auth/pin/lock'); assert.equal(r.status, 200); assert.equal((await p2('GET', '/audit/chats')).status, 423); // "bloquear agora"
  r = await login(p2, 'maria@t.com', 'senha12345'); assert.equal(r.body.user.pin.enabled, true); // entrar de novo não deixa nada destravado
  await p2('POST', '/auth/pin/verify', { pin: '1234' }); assert.equal((await p2('GET', '/audit/chats')).status, 200);
  await login(p2, 'maria@t.com', 'senha12345'); assert.equal((await p2('GET', '/audit/chats')).status, 423);
  assert.equal((await client('anon')('GET', '/audit/chats')).status, 401);
  ok('abas com PIN ficam travadas até digitar o código (no servidor também, onde a API é só daquela aba); vale 30 min; dá para travar de novo');

  // --- alterar abas ou PIN pede o PIN atual; trocar o PIN invalida o desbloqueio anterior
  r = await p('PUT', '/auth/pin', { tabs: ['auditoria'] }); assert.equal(r.status, 403); assert.equal(r.body.code, 'PIN_WRONG');
  r = await p('PUT', '/auth/pin', { tabs: ['auditoria'], currentPin: '9999' }); assert.equal(r.status, 403);
  r = await p('PUT', '/auth/pin', { tabs: ['auditoria'], currentPin: '1234' }); assert.equal(r.status, 200); assert.deepEqual(r.body.user.pin.tabs, ['auditoria']);
  assert.equal((await p2('GET', '/contracts')).status, 200); // "contratos" deixou de ser protegida
  await p2('POST', '/auth/pin/verify', { pin: '1234' }); assert.equal((await p2('GET', '/audit/chats')).status, 200);
  r = await p('PUT', '/auth/pin', { pin: '5678', tabs: ['auditoria', 'portfolio'], currentPin: '1234' }); assert.equal(r.status, 200);
  assert.equal((await p2('GET', '/audit/chats')).status, 423); // o PIN mudou: o desbloqueio antigo não vale
  assert.equal((await p2('POST', '/auth/pin/verify', { pin: '1234' })).status, 403); assert.equal((await p2('POST', '/auth/pin/verify', { pin: '5678' })).status, 200);
  assert.equal((await p2('GET', '/portfolios')).status, 200); await p2('POST', '/auth/pin/lock'); assert.equal((await p2('GET', '/portfolios')).status, 423);
  ok('alterar abas/PIN exige o PIN atual; ao trocar o PIN, o desbloqueio antigo deixa de valer');

  // --- 5 erros seguidos travam as tentativas (só "Esqueci o código PIN" destrava)
  for (let i = 0; i < 5; i++) { r = await p2('POST', '/auth/pin/verify', { pin: '0001' }); assert.equal(r.status, 403); }
  r = await p2('POST', '/auth/pin/verify', { pin: '5678' }); assert.equal(r.status, 429); assert.equal(r.body.code, 'PIN_LOCKED'); // até o PIN certo espera
  ok('depois de 5 PINs errados as tentativas ficam bloqueadas por alguns minutos');

  // --- esqueci o código PIN: confirma e-mail/CPF e recebe o código no WhatsApp pela conexão do admin
  evoState = 'close';
  r = await p2('POST', '/auth/pin/forgot', { identifier: 'maria@t.com' }); assert.equal(r.status, 503); assert.equal(r.body.code, 'RECOVERY_UNAVAILABLE'); // admin sem WhatsApp conectado
  evoState = 'open';
  r = await a('POST', '/instances'); assert.equal(r.status, 201); const adminInst = r.body.instance; assert.equal(adminInst.name, 'admin');
  const codeFrom = (msg) => /\*(\d{6})\*/.exec(msg.text)[1];
  r = await p2('POST', '/auth/pin/forgot', { identifier: 'outra@pessoa.com' }); assert.equal(r.status, 400); // não confere com a conta
  r = await p2('POST', '/auth/pin/forgot', {}); assert.equal(r.status, 400);
  sent.length = 0;
  r = await p2('POST', '/auth/pin/forgot', { identifier: '111.444.777-35' }); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.phoneHint, 'final 1234'); // pode usar o CPF
  assert.equal(sent.length, 1); assert.equal(sent[0].number, '5585999991234'); assert.match(sent[0].text, /código PIN/); const pinCode = codeFrom(sent[0]);
  assert.equal((await db.query("SELECT count(*)::int n FROM verification_codes WHERE code_hash = $1", [pinCode])).rows[0].n, 0); // só o hash fica no banco
  r = await p2('POST', '/auth/pin/forgot', { identifier: 'maria@t.com' }); assert.equal(r.status, 429); assert.equal(sent.length, 1); // 1 minuto entre códigos
  r = await p2('POST', '/auth/pin/reset', { code: pinCode === '000000' ? '111111' : '000000', pin: '4321' }); assert.equal(r.status, 400); assert.equal(r.body.code, 'CODE_WRONG');
  r = await p2('POST', '/auth/pin/reset', { code: pinCode, pin: '43' }); assert.equal(r.status, 400); // PIN novo inválido não gasta o código
  r = await p2('POST', '/auth/pin/reset', { code: pinCode, pin: '4321' }); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.user.pin.enabled, true); assert.ok(r.body.pinUnlockedUntil > Date.now());
  assert.deepEqual(r.body.user.pin.tabs, ['auditoria', 'portfolio']); // as abas continuam as mesmas
  r = await p2('POST', '/auth/pin/reset', { code: pinCode, pin: '4321' }); assert.equal(r.status, 400); assert.equal(r.body.code, 'CODE_INVALID'); // cada código vale uma vez
  await p2('POST', '/auth/pin/lock'); assert.equal((await p2('POST', '/auth/pin/verify', { pin: '5678' })).status, 403); assert.equal((await p2('POST', '/auth/pin/verify', { pin: '4321' })).status, 200); // PIN novo; e o bloqueio por tentativas foi zerado
  // código vencido e excesso de tentativas
  await p2('POST', '/auth/pin/forgot', { identifier: 'maria@t.com' }); await db.query("UPDATE verification_codes SET expires_at = now() - interval '1 minute'");
  r = await p2('POST', '/auth/pin/reset', { code: codeFrom(sent.at(-1)) }); assert.equal(r.status, 400); assert.equal(r.body.code, 'CODE_INVALID');
  await p2('POST', '/auth/pin/forgot', { identifier: 'maria@t.com' }); const c2 = codeFrom(sent.at(-1)); const wrong = c2 === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) { r = await p2('POST', '/auth/pin/reset', { code: wrong }); assert.equal(r.status, 400); }
  r = await p2('POST', '/auth/pin/reset', { code: c2 }); assert.equal(r.status, 400); assert.equal(r.body.code, 'CODE_INVALID'); // depois de 5 erros nem o código certo vale
  // sem informar PIN novo, remove o PIN
  await p2('POST', '/auth/pin/forgot', { identifier: 'maria@t.com' }); r = await p2('POST', '/auth/pin/reset', { code: codeFrom(sent.at(-1)) });
  assert.equal(r.status, 200); assert.deepEqual(r.body.user.pin, { enabled: false, tabs: [] }); assert.equal(r.body.pinUnlockedUntil, null);
  assert.equal((await p2('GET', '/audit/chats')).status, 200);
  r = await p2('POST', '/auth/pin/forgot', { identifier: 'maria@t.com' }); assert.equal(r.status, 400); assert.equal(r.body.code, 'PIN_NOT_SET');
  ok('esqueci o PIN: pede e-mail ou CPF/CNPJ, o admin envia o código pelo WhatsApp (só hash no banco), vale 1 vez, vence, limita tentativas e permite PIN novo ou remover');

  // --- remover o PIN com o PIN atual
  r = await p('PUT', '/auth/pin', { pin: '2468', tabs: ['auditoria'] }); assert.equal(r.status, 200);
  r = await p('POST', '/auth/pin/disable', { currentPin: '0000' }); assert.equal(r.status, 403);
  r = await p('POST', '/auth/pin/disable', { currentPin: '2468' }); assert.equal(r.status, 200); assert.deepEqual(r.body.user.pin, { enabled: false, tabs: [] });
  assert.equal((await p2('GET', '/audit/chats')).status, 200);
  ok('remover o PIN exige o PIN atual');

  // --- esqueci a senha (tela de login): código pelo WhatsApp do admin
  r = await anon2('POST', '/auth/forgot', { identifier: '' }); assert.equal(r.status, 400);
  sent.length = 0;
  r = await anon2('POST', '/auth/forgot', { identifier: 'naoexiste@x.com' }); assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true }); assert.equal(sent.length, 0); // mesma resposta, sem revelar quem tem conta
  r = await anon2('POST', '/auth/forgot', { identifier: 'e@t.com' }); assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true }); assert.equal(sent.length, 0); // conta sem WhatsApp cadastrado: nada é enviado
  r = await anon2('POST', '/auth/forgot', { identifier: 'maria@t.com' }); assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true }); assert.equal(sent.length, 1); assert.equal(sent[0].number, '5585999991234'); assert.match(sent[0].text, /senha/);
  const pwCode = codeFrom(sent[0]);
  r = await anon2('POST', '/auth/reset', { identifier: 'maria@t.com', code: pwCode === '123456' ? '654321' : '123456', password: 'senhaNova789' }); assert.equal(r.status, 400);
  r = await anon2('POST', '/auth/reset', { identifier: 'maria@t.com', code: pwCode, password: 'curta' }); assert.equal(r.status, 400); // senha fraca não gasta o código
  r = await anon2('POST', '/auth/reset', { identifier: 'naoexiste@x.com', code: pwCode, password: 'senhaNova789' }); assert.equal(r.status, 400); assert.equal(r.body.code, 'CODE_INVALID');
  r = await anon2('POST', '/auth/reset', { identifier: '111.444.777-35', code: pwCode, password: 'senhaNova789' }); assert.equal(r.status, 200); // vale também pelo CPF
  assert.equal((await mclient()('POST', '/auth/login', { identifier: 'maria@t.com', password: 'senha12345' })).status, 401); await login(mclient(), 'maria@t.com', 'senhaNova789');
  r = await anon2('POST', '/auth/reset', { identifier: 'maria@t.com', code: pwCode, password: 'outraSenha000' }); assert.equal(r.status, 400); // o código só vale uma vez
  r = await p('PATCH', '/auth/profile', { newPassword: 'senha12345', currentPassword: 'senhaNova789' }); assert.equal(r.status, 200); // volta ao original
  ok('esqueci a senha: não revela quem tem conta; o código vai pelo WhatsApp do admin; vale uma vez; troca a senha');

  r = await a('DELETE', `/instances/${adminInst.id}`); assert.equal(r.status, 200); evoState = prevEvo;
  evoState = 'close'; r = await anon2('POST', '/auth/forgot', { identifier: 'maria@t.com' }); assert.equal(r.status, 503); assert.equal(r.body.code, 'RECOVERY_UNAVAILABLE'); evoState = prevEvo;
  ok('sem WhatsApp do admin conectado a recuperação avisa que está indisponível');

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
  assert.equal((await db.query('SELECT count(*)::int n FROM portfolios WHERE user_id = $1', [maria2.id])).rows[0].n, 0);
  assert.equal((await pub('GET', '/public/portfolio?u=maria-teste')).status, 404); ok('as páginas de portfólio do usuário excluído também são apagadas (e o link deixa de abrir)');
  const gone = (await db.query('SELECT (SELECT count(*) FROM audit_chats)::int c, (SELECT count(*) FROM audit_messages)::int m, (SELECT count(*) FROM audit_labels)::int l, (SELECT count(*) FROM audit_chat_labels)::int cl, (SELECT count(*) FROM instances WHERE user_id = $1)::int i', [maria2.id])).rows[0];
  assert.deepEqual(gone, { c: 0, m: 0, l: 0, cl: 0, i: 0 }); ok('conversas, mensagens, etiquetas e conexões de auditoria do usuário excluído também são apagadas');

  console.log('\nTudo certo ✔');
} catch (e) {
  console.error('\nFALHOU:', e.message); if (e.stack) console.error(e.stack.split('\n').filter((l) => l.includes('smoke-test.mjs')).slice(0, 2).join('\n')); process.exitCode = 1;
} finally {
  server.kill(); evo.close(); ip.close(); graph.close();
  await db.end().catch(() => {});
  await base.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
  await base.end().catch(() => {});
}
