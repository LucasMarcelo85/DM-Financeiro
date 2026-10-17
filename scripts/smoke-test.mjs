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

const evo = http.createServer(async (req, res) => {
  const b = await readBody(req);
  if (req.headers.apikey !== 'k') return json(res, 401, { message: 'unauthorized' });
  if (req.url === '/instance/create') return json(res, 201, { instance: { instanceName: b.instanceName }, qrcode: { base64: 'data:image/png;base64,AAAA' } });
  if (req.url.startsWith('/instance/connect/')) return json(res, 200, { base64: 'AAAA' });
  if (req.url.startsWith('/instance/connectionState/')) return json(res, 200, { instance: { state: evoState } });
  if (req.url.startsWith('/instance/logout/')) { evoState = 'close'; return json(res, 200, {}); }
  if (req.url.startsWith('/instance/delete/')) return json(res, 200, {});
  if (req.url.startsWith('/message/sendText/')) { sent.push(b); return json(res, 201, { key: {} }); }
  json(res, 404, { message: 'not found' });
});
let paid = false;
const ip = http.createServer(async (req, res) => {
  const b = await readBody(req);
  if (req.url === '/links') return json(res, 200, { url: `https://checkout.example/pay?o=${b.order_nsu}` });
  if (req.url === '/payment_check') return json(res, 200, { success: true, paid, amount: 4990 });
  json(res, 404, {});
});
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
const evoPort = await listen(evo);
const ipPort = await listen(ip);

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
    INFINITEPAY_HANDLE: 'loja', INFINITEPAY_API_URL: `http://127.0.0.1:${ipPort}`, SCHEDULER_INTERVAL_SECONDS: '1',
    ADMIN_EMAIL: 'admin@t.com', ADMIN_PASSWORD: 'admin12345', PLAN_PRATA_PRICE: '49.90', APP_TIMEZONE: 'America/Sao_Paulo' },
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
  r = await u('GET', '/contracts'); assert.equal(r.body.contracts.length, 1); assert.equal(r.body.limit, 3); assert.equal(r.body.contracts[0].data, undefined);
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

  r = await u('POST', '/contracts', { name: 'Terceiro', data: blank }); assert.equal(r.status, 201); const ct3 = r.body.contract; // plano prata: 3 modelos
  r = await u('POST', '/contracts', { name: 'Quarto', data: blank }); assert.equal(r.status, 403); assert.equal(r.body.code, 'LIMIT_REACHED');
  r = await u('POST', `/contracts/${ct1.id}/duplicate`); assert.equal(r.status, 403);
  r = await u('DELETE', `/contracts/${ct3.id}`); assert.equal(r.status, 200);
  r = await u('POST', `/contracts/${ct1.id}/duplicate`); assert.equal(r.status, 201); assert.equal(r.body.contract.name, 'Novo nome (cópia)'); assert.equal(r.body.contract.pageCount, 2);
  r = await u('GET', `/contracts/${r.body.contract.id}`); assert.equal(r.body.contract.data.pages[0].els[0].text, 'CONTRATO');
  ok('limite de modelos por plano (prata = 3); duplicar e excluir liberam vaga');

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
  r = await client('w')('POST', '/webhooks/infinitepay', { order_nsu: 'inexistente' }); assert.equal(r.status, 400);

  // ===== admin =====
  r = await u('GET', '/admin/users'); assert.equal(r.status, 403);
  r = await a('POST', '/auth/login', { identifier: 'admin@t.com', password: 'admin12345' }); assert.equal(r.body.user.role, 'admin');
  r = await a('GET', '/admin/users'); assert.equal(r.body.users.length, 3);
  const maria2 = r.body.users.find((x) => x.email === 'maria@t.com');
  r = await a('PATCH', `/admin/users/${maria2.id}/plan`, { plan: 'ouro' }); assert.equal(r.body.user.limits.instances, 3);
  r = await a('POST', `/admin/users/${maria2.id}/grant`); assert.equal(r.body.user.access.daysLeft, 60); ok('admin troca plano e dá acesso mensal (+30 dias)');
  const me = (await a('GET', '/auth/me')).body.user;
  r = await a('DELETE', `/admin/users/${me.id}`); assert.equal(r.status, 400);
  r = await a('DELETE', `/admin/users/${maria2.id}`); assert.equal(r.status, 200);
  const left = (await db.query('SELECT (SELECT count(*) FROM contacts WHERE user_id=$1)::int c, (SELECT count(*) FROM schedules WHERE user_id=$1)::int s, (SELECT count(*) FROM messages WHERE user_id=$1)::int m', [maria2.id])).rows[0];
  assert.deepEqual(left, { c: 0, s: 0, m: 0 }); ok('admin exclui usuário e tudo dele (clientes, cobranças e histórico) é apagado em cascata');
  assert.equal((await db.query('SELECT count(*)::int n FROM contracts WHERE user_id = $1', [maria2.id])).rows[0].n, 0); ok('os contratos do usuário excluído também são apagados');

  console.log('\nTudo certo ✔');
} catch (e) {
  console.error('\nFALHOU:', e.message); if (e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n')); process.exitCode = 1;
} finally {
  server.kill(); evo.close(); ip.close();
  await db.end().catch(() => {});
  await base.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {});
  await base.end().catch(() => {});
}
