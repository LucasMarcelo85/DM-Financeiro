// Teste de fumaça: sobe Evolution e InfinitePay falsas + o servidor com banco temporário
// e percorre o fluxo principal. Rode com: npm run smoke
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

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
  if (req.url.startsWith('/instance/logout/')) { evoState = 'close'; return json(res, 200, { status: 'SUCCESS' }); }
  if (req.url.startsWith('/instance/delete/')) return json(res, 200, { status: 'SUCCESS' });
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
const port = 3999;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-'));

const server = spawn('node', ['server/index.js'], {
  env: { ...process.env, PORT: String(port), DB_PATH: path.join(tmp, 't.db'), JWT_SECRET: 'x'.repeat(40), APP_URL: 'http://localhost:5173',
    EVOLUTION_API_URL: `http://127.0.0.1:${evoPort}`, EVOLUTION_API_KEY: 'k', EVOLUTION_MESSAGE_DELAY_MS: '50',
    INFINITEPAY_HANDLE: 'loja', INFINITEPAY_API_URL: `http://127.0.0.1:${ipPort}`,
    ADMIN_EMAIL: 'admin@t.com', ADMIN_PASSWORD: 'admin12345', PLAN_PRATA_PRICE: '49.90' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('API rodando') && r()));

const jar = {};
function client(name) {
  jar[name] = '';
  return async (method, url, body) => {
    const res = await fetch(`http://localhost:${port}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: jar[name] }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) jar[name] = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
}
const ok = (m) => console.log('  ✓', m);

try {
  const u = client('u'), a = client('a');
  let r = await u('POST', '/auth/register', { kind: 'PF', name: 'Maria Teste', document: '111.444.777-35', email: 'maria@t.com', phone: '(85) 99999-1234', password: 'senha12345', plan: 'prata' });
  assert.equal(r.status, 201); assert.equal(r.body.user.role, 'usuario'); assert.equal(r.body.user.access.status, 'trial'); assert.equal(r.body.user.access.daysLeft, 3);
  ok('cadastro PF com teste grátis de 3 dias (role usuario)');

  r = await client('x')('POST', '/auth/register', { kind: 'PF', name: 'Fulano', document: '111.111.111-11', email: 'f@t.com', password: 'senha12345' });
  assert.equal(r.status, 400); ok('CPF inválido é recusado');
  r = await client('x')('POST', '/auth/register', { kind: 'PJ', name: 'Empresa LTDA', document: '11.222.333/0001-81', email: 'e@t.com', password: 'senha12345' });
  assert.equal(r.status, 201); ok('cadastro PJ com CNPJ válido');
  r = await client('x')('POST', '/auth/register', { kind: 'PF', name: 'Maria 2', document: '111.444.777-35', email: 'm2@t.com', password: 'senha12345' });
  assert.equal(r.status, 409); ok('CPF duplicado é recusado');

  r = await u('GET', '/instances'); assert.equal(r.status, 200); assert.equal(r.body.limit, 1);
  r = await u('POST', '/instances'); assert.equal(r.status, 201); assert.equal(r.body.instance.name, '11144477735'); assert.ok(r.body.qr.startsWith('data:image'));
  const instId = r.body.instance.id; ok('instância criada com o nome do CPF + QR');
  r = await u('POST', '/instances'); assert.equal(r.status, 403); ok('limite de instâncias do plano respeitado');

  r = await u('GET', '/instances'); assert.equal(r.body.instances[0].connected, false);
  r = await u('POST', '/messages', { kind: 'cobranca', instanceId: instId, number: '(85) 98888-7777', text: 'Oi', extra: 'pix@x.com' });
  assert.equal(r.status, 409); ok('envio bloqueado com WhatsApp desconectado');

  evoState = 'open';
  r = await u('GET', '/instances'); assert.equal(r.body.instances[0].connected, true); ok('luz verde quando conectado');
  r = await u('POST', '/messages', { kind: 'cobranca', instanceId: instId, number: '(85) 98888-7777', text: 'Olá, sua fatura vence hoje.', extra: 'https://pay.link/abc' });
  assert.equal(r.status, 200); assert.equal(sent.length, 2); assert.equal(sent[0].number, '5585988887777'); assert.equal(sent[1].text, 'https://pay.link/abc');
  ok('cobrança com link enviada em 2 blocos');
  sent.length = 0;
  r = await u('POST', '/messages', { kind: 'lembrete', instanceId: instId, number: '85988887777', text: 'Lembrete' });
  assert.equal(sent.length, 1); ok('lembrete sem link enviado em 1 bloco');
  r = await u('GET', '/messages?kind=cobranca'); assert.equal(r.body.messages.length, 1);

  r = await u('GET', '/admin/users'); assert.equal(r.status, 403); ok('usuário comum não acessa o admin');

  // Fim do teste grátis -> bloqueio -> pagamento
  const Database = (await import('better-sqlite3')).default;
  const raw = new Database(path.join(tmp, 't.db')); raw.prepare("UPDATE users SET trial_ends_at = ? WHERE email = 'maria@t.com'").run(Date.now() - 1000);
  r = await u('GET', '/instances'); assert.equal(r.status, 402); assert.equal(r.body.code, 'PAYMENT_REQUIRED'); ok('acesso bloqueado após o teste grátis');
  r = await u('POST', '/billing/checkout', { plan: 'prata' }); assert.equal(r.status, 200); assert.ok(r.body.url.includes('checkout.example'));
  const order = decodeURIComponent(r.body.url.split('o=')[1]);
  r = await u('POST', '/billing/confirm', { order_nsu: order, transaction_nsu: 't1', slug: 's1' }); assert.equal(r.status, 402); ok('pagamento não confirmado não libera acesso');
  paid = true;
  r = await u('POST', '/billing/confirm', { order_nsu: order, transaction_nsu: 't1', slug: 's1' });
  assert.equal(r.status, 200); assert.equal(r.body.user.access.status, 'paid'); assert.equal(r.body.user.access.daysLeft, 30);
  r = await u('GET', '/instances'); assert.equal(r.status, 200); ok('após pagar, acesso liberado por 30 dias');
  r = await u('POST', '/billing/confirm', { order_nsu: order, transaction_nsu: 't1', slug: 's1' }); assert.equal(r.body.user.access.daysLeft, 30); ok('confirmação repetida não soma dias');

  r = await client('w')('POST', '/webhooks/infinitepay', { order_nsu: 'inexistente' }); assert.equal(r.status, 400); ok('webhook com pedido falso é recusado');

  // Admin
  r = await a('POST', '/auth/login', { identifier: 'admin@t.com', password: 'admin12345' }); assert.equal(r.body.user.role, 'admin');
  r = await a('GET', '/admin/users'); assert.equal(r.body.users.length, 3);
  const maria = r.body.users.find((x) => x.email === 'maria@t.com');
  r = await a('PATCH', `/admin/users/${maria.id}/plan`, { plan: 'ouro' }); assert.equal(r.body.user.limits.instances, 3); ok('admin muda o plano');
  r = await a('POST', `/admin/users/${maria.id}/grant`); assert.equal(r.body.user.access.daysLeft, 60); ok('admin dá acesso mensal (+30 dias)');
  const me = (await a('GET', '/auth/me')).body.user;
  r = await a('DELETE', `/admin/users/${me.id}`); assert.equal(r.status, 400);
  r = await a('DELETE', `/admin/users/${maria.id}`); assert.equal(r.status, 200); ok('admin exclui usuário (e não a si mesmo)');
  r = await u('GET', '/auth/me'); assert.equal(r.status, 401); ok('sessão do usuário excluído deixa de valer');

  console.log('\nTudo certo ✔');
} catch (e) {
  console.error('\nFALHOU:', e.message); process.exitCode = 1;
} finally {
  server.kill(); evo.close(); ip.close(); fs.rmSync(tmp, { recursive: true, force: true });
}
