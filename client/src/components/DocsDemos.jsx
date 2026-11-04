import { useMemo, useState } from 'react';

// Prévias interativas da documentação: usam dados de exemplo, nada aqui é salvo ou enviado.
const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const Lamp = ({ state }) => <span className={`lamp is-${state}`} style={{ width: 14, height: 14 }} aria-hidden="true" />;
const LAMP_LABEL = { on: 'Conectado', off: 'Desconectado', pending: 'Aguardando leitura' };

function WhatsAppDemo() {
  const [lines, setLines] = useState([{ id: 1, name: 'Atendimento', phone: '(11) 98888-0001', state: 'on' }, { id: 2, name: 'Financeiro', phone: '(11) 97777-0002', state: 'off' }]);
  const [qrFor, setQrFor] = useState(null);
  const set = (id, state) => setLines((rows) => rows.map((r) => (r.id === id ? { ...r, state } : r)));
  const cells = useMemo(() => Array.from({ length: 169 }, (_, i) => ((i * 7 + (qrFor || 0) * 13) % 5 < 2 || i % 13 === 0 || i < 13)), [qrFor]);
  return (
    <div className="dc-stack">
      {lines.map((l) => (
        <div className="dc-row" key={l.id}>
          <Lamp state={l.state} />
          <div className="dc-grow"><strong>{l.name}</strong><div className="muted small">{l.phone} · {LAMP_LABEL[l.state]}</div></div>
          {l.state === 'on'
            ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => set(l.id, 'off')}>Desconectar</button>
            : <button type="button" className="btn btn-primary btn-sm" onClick={() => { set(l.id, 'pending'); setQrFor(l.id); }}>Conectar por QR Code</button>}
        </div>
      ))}
      {qrFor && (
        <div className="dc-qr">
          <div className="dc-qr-grid" aria-label="QR Code de exemplo">{cells.map((on, i) => <i key={i} className={on ? 'on' : ''} />)}</div>
          <p className="small muted">No celular: WhatsApp &gt; Aparelhos conectados &gt; Conectar aparelho.</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { set(qrFor, 'on'); setQrFor(null); }}>Simular leitura do código</button>
        </div>
      )}
    </div>
  );
}

const PEOPLE = [{ name: 'Ana Souza', phone: '(11) 91234-5678' }, { name: 'Bruno Lima', phone: '(21) 99876-5432' }, { name: 'Carla Dias', phone: '(31) 98765-4321' }];

function ClientsDemo() {
  const [rows, setRows] = useState(PEOPLE);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ name: '', phone: '' });
  const shown = rows.filter((r) => `${r.name} ${r.phone}`.toLowerCase().includes(q.toLowerCase()));
  const digits = form.phone.replace(/\D/g, '');
  const add = (e) => { e.preventDefault(); setRows([...rows, { name: form.name.trim(), phone: form.phone }]); setForm({ name: '', phone: '' }); };
  return (
    <div className="dc-stack">
      <input className="input" placeholder="Buscar cliente..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar cliente" />
      <ul className="dc-list">{shown.map((r) => <li key={r.name + r.phone}><strong>{r.name}</strong><span className="muted">{r.phone}</span></li>)}{!shown.length && <li className="muted">Nenhum cliente encontrado.</li>}</ul>
      <form className="dc-inline" onSubmit={add}>
        <input className="input" placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Nome" />
        <input className="input" placeholder="WhatsApp com DDD" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} aria-label="WhatsApp" />
        <button className="btn btn-primary btn-sm" disabled={!form.name.trim() || digits.length < 10}>Adicionar</button>
      </form>
      {form.phone && digits.length < 10 && <small className="muted">O telefone precisa ter DDD (10 ou 11 dígitos).</small>}
    </div>
  );
}

const fillTemplate = (t, v) => t.replace(/\{nome\}/g, v.nome).replace(/\{valor\}/g, v.valor).replace(/\{vencimento\}/g, v.vencimento);

function ChargesDemo() {
  const [f, setF] = useState({ cliente: PEOPLE[0].name, valor: '150,00', data: '2026-12-10', monthly: false });
  const [items, setItems] = useState([]);
  const dateBR = (iso) => iso.split('-').reverse().join('/');
  const msg = fillTemplate('Olá {nome}! Tudo bem? Passando para lembrar do pagamento de {valor} com vencimento em {vencimento}.', { nome: f.cliente.split(' ')[0], valor: `R$ ${f.valor}`, vencimento: dateBR(f.data) });
  return (
    <div className="dc-stack">
      <div className="dc-inline">
        <select className="input" value={f.cliente} onChange={(e) => setF({ ...f, cliente: e.target.value })} aria-label="Cliente">{PEOPLE.map((p) => <option key={p.name}>{p.name}</option>)}</select>
        <input className="input" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} aria-label="Valor" />
        <input className="input" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} aria-label="Vencimento" />
      </div>
      <label className="small"><input type="checkbox" checked={f.monthly} onChange={(e) => setF({ ...f, monthly: e.target.checked })} /> Repetir todo mês</label>
      <div className="dc-bubble">{msg}</div>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setItems([{ ...f, id: items.length + 1 }, ...items])}>Agendar cobrança</button>
      {items.map((i) => <div className="dc-row" key={i.id}><div className="dc-grow"><strong>{i.cliente}</strong> · R$ {i.valor}<div className="muted small">{dateBR(i.data)}{i.monthly ? ' · mensal' : ' · avulsa'}</div></div><span className="badge" style={{ background: '#f2a33a', color: '#14202e' }}>Agendada</span></div>)}
    </div>
  );
}

function ContractsDemo() {
  const [v, setV] = useState({ nome: 'Ana Souza', doc: '123.456.789-00' });
  const [text, setText] = useState('Pelo presente contrato, {{cliente.nome}} (CPF {{cliente.documento}}) contrata os serviços da empresa a partir de {{data.hoje}}.');
  const today = new Date().toLocaleDateString('pt-BR');
  const out = text.replace(/\{\{cliente\.nome\}\}/g, v.nome).replace(/\{\{cliente\.documento\}\}/g, v.doc).replace(/\{\{data\.hoje\}\}/g, today);
  return (
    <div className="dc-two">
      <div className="dc-stack">
        <label className="field"><span>Modelo (edite o texto)</span><textarea className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <div className="dc-inline">
          <input className="input" value={v.nome} onChange={(e) => setV({ ...v, nome: e.target.value })} aria-label="Nome do cliente" />
          <input className="input" value={v.doc} onChange={(e) => setV({ ...v, doc: e.target.value })} aria-label="Documento" />
        </div>
      </div>
      <div className="dc-paper"><h3>Contrato de prestação de serviços</h3><p>{out}</p><div className="dc-sign">Assinatura</div></div>
    </div>
  );
}

const CHATS = [
  { id: 1, who: 'Marina', labels: ['Venda'], msgs: ['Oi, vocês entregam hoje?', 'Pode me passar o preço do plano anual?'] },
  { id: 2, who: 'Rafael', labels: ['Suporte'], msgs: ['Meu pedido não chegou ainda.', 'Obrigado pelo retorno!'] },
  { id: 3, who: 'Julia', labels: ['Venda', 'Urgente'], msgs: ['Quero fechar hoje, qual o PIX?'] },
];

function AuditDemo() {
  const [label, setLabel] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(1);
  const [notes, setNotes] = useState({});
  const [draft, setDraft] = useState('');
  const list = CHATS.filter((c) => (!label || c.labels.includes(label)) && (!q || c.msgs.some((m) => m.toLowerCase().includes(q.toLowerCase())) ));
  const chat = CHATS.find((c) => c.id === sel);
  return (
    <div className="dc-two">
      <div className="dc-stack">
        <input className="input" placeholder="Buscar palavra (ex.: preço)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
        <div className="dc-chips">{['', 'Venda', 'Suporte', 'Urgente'].map((l) => <button type="button" key={l || 'all'} className={`btn btn-sm ${label === l ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setLabel(l)}>{l || 'Todas'}</button>)}</div>
        <ul className="dc-list">{list.map((c) => <li key={c.id}><button type="button" className={`dc-link ${sel === c.id ? 'is-on' : ''}`} onClick={() => setSel(c.id)}><strong>{c.who}</strong> <span className="muted small">{c.labels.join(', ')}</span></button></li>)}{!list.length && <li className="muted">Nenhuma conversa.</li>}</ul>
      </div>
      <div className="dc-stack">
        <strong>Conversa com {chat.who}</strong>
        {chat.msgs.map((m, i) => <div key={i} className="dc-bubble">{m}</div>)}
        {(notes[chat.id] || []).map((n, i) => <div key={i} className="dc-note">Anotação: {n}</div>)}
        <div className="dc-inline"><input className="input" placeholder="Anotação interna" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Anotação" /><button type="button" className="btn btn-ghost btn-sm" disabled={!draft.trim()} onClick={() => { setNotes({ ...notes, [chat.id]: [...(notes[chat.id] || []), draft.trim()] }); setDraft(''); }}>Anotar</button></div>
      </div>
    </div>
  );
}

const BLOCKS = [['capa', 'Capa'], ['sobre', 'Sobre'], ['produtos', 'Produtos'], ['contato', 'Contato']];

function PortfolioDemo() {
  const [on, setOn] = useState(['capa', 'sobre', 'contato']);
  const [color, setColor] = useState('#f2a33a');
  const [title, setTitle] = useState('Studio Aurora');
  const toggle = (k) => setOn((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  return (
    <div className="dc-two">
      <div className="dc-stack">
        <label className="field"><span>Nome da página</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field"><span>Cor da marca</span><input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Cor" /></label>
        <strong className="small">Blocos</strong>
        {BLOCKS.map(([k, l]) => <label key={k} className="small"><input type="checkbox" checked={on.includes(k)} onChange={() => toggle(k)} /> {l}</label>)}
      </div>
      <div className="dc-site">
        {on.includes('capa') && <div className="dc-site-cover" style={{ background: color }}><strong>{title || 'Sua marca'}</strong><span>Bem-vindo(a)!</span></div>}
        {on.includes('sobre') && <section><h3>Sobre</h3><p className="muted">Conte aqui a história do seu negócio.</p></section>}
        {on.includes('produtos') && <section><h3>Produtos</h3><div className="dc-cards"><i style={{ borderColor: color }} /><i style={{ borderColor: color }} /><i style={{ borderColor: color }} /></div></section>}
        {on.includes('contato') && <section><h3>Contato</h3><span className="dc-pill" style={{ background: color }}>Falar no WhatsApp</span></section>}
        {!on.length && <p className="muted">Ative um bloco para ver a página.</p>}
      </div>
    </div>
  );
}

const PRODUCTS = [
  { id: 1, name: 'Camiseta Básica', prices: { Varejo: 5990, Atacado: 4500 }, stock: { Matriz: 12, Depósito: 40 } },
  { id: 2, name: 'Caneca Personalizada', prices: { Varejo: 3490, Atacado: 2600 }, stock: { Matriz: 5, Depósito: 0 } },
];

function ProductsDemo() {
  const [price, setPrice] = useState('Varejo');
  const [flow, setFlow] = useState('Matriz');
  const [stock, setStock] = useState(() => Object.fromEntries(PRODUCTS.map((p) => [p.id, { ...p.stock }])));
  const adj = (id, d) => setStock((s) => ({ ...s, [id]: { ...s[id], [flow]: Math.max(0, s[id][flow] + d) } }));
  return (
    <div className="dc-stack">
      <div className="dc-inline">
        <label className="small">Forma de preço <select className="input" value={price} onChange={(e) => setPrice(e.target.value)}><option>Varejo</option><option>Atacado</option></select></label>
        <label className="small">Fluxo de estoque <select className="input" value={flow} onChange={(e) => setFlow(e.target.value)}><option>Matriz</option><option>Depósito</option></select></label>
      </div>
      {PRODUCTS.map((p) => {
        const q = stock[p.id][flow];
        return (
          <div className="dc-row" key={p.id}>
            <div className="dc-grow"><strong>{p.name}</strong><div className="muted small">{brl(p.prices[price])} · {q === 0 ? <span style={{ color: 'var(--red-d)' }}>Sem estoque</span> : `${q} em estoque`}</div></div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => adj(p.id, -1)} aria-label={`Diminuir ${p.name}`}>−</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => adj(p.id, 1)} aria-label={`Aumentar ${p.name}`}>+</button>
          </div>
        );
      })}
    </div>
  );
}

const FLOW = ['novo', 'atendido', 'entregue'];
function OrdersDemo() {
  const [orders, setOrders] = useState([{ id: 101, who: 'Ana Souza', total: 12980, s: 0 }, { id: 102, who: 'Bruno Lima', total: 3490, s: 0 }, { id: 103, who: 'Carla Dias', total: 8970, s: 1 }]);
  const [cart, setCart] = useState(0);
  const advance = (id) => setOrders((rows) => rows.map((o) => (o.id === id && o.s < FLOW.length - 1 ? { ...o, s: o.s + 1 } : o)));
  const sales = orders.filter((o) => o.s > 0).reduce((n, o) => n + o.total, 0);
  return (
    <div className="dc-stack">
      <div className="dc-stats"><div><span className="muted small">Novos</span><strong>{orders.filter((o) => o.s === 0).length}</strong></div><div><span className="muted small">Vendas atendidas</span><strong>{brl(sales)}</strong></div></div>
      {orders.map((o) => (
        <div className="dc-row" key={o.id}>
          <div className="dc-grow"><strong>#{o.id} · {o.who}</strong><div className="muted small">{brl(o.total)}</div></div>
          <span className="badge" style={{ background: ['#f2a33a', '#1f55a6', '#1fa971'][o.s] }}>{FLOW[o.s]}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={o.s === FLOW.length - 1} onClick={() => advance(o.id)}>Avançar</button>
        </div>
      ))}
      <div className="dc-row"><div className="dc-grow"><strong>Frente de caixa</strong><div className="muted small">Venda no balcão: {cart} item(ns) · {brl(cart * 3490)}</div></div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setCart(cart + 1)}>+ Caneca</button><button type="button" className="btn btn-primary btn-sm" disabled={!cart} onClick={() => setCart(0)}>Finalizar</button></div>
    </div>
  );
}

const SAMPLE = {
  '/api/v1/products': { data: [{ id: 1, name: 'Camiseta Básica', price_cents: 5990, active: true }], total: 1 },
  '/api/v1/orders': { data: [{ id: 101, status: 'novo', total_cents: 12980 }], total: 1 },
  '/api/v1/customers': { data: [{ name: 'Ana Souza', phone: '5511912345678' }], total: 1 },
};
const EVENTS = { 'order.created': 'Novo pedido recebido', 'order.paid': 'Pagamento confirmado', 'product.updated': 'Produto atualizado' };

function ApiDemo() {
  const [path, setPath] = useState('/api/v1/products');
  const [res, setRes] = useState(null);
  const [event, setEvent] = useState('order.created');
  const token = 'dm_live_xxxxxxxxxxxx';
  return (
    <div className="dc-two">
      <div className="dc-stack">
        <strong>Consultar (GET)</strong>
        <select className="input" value={path} onChange={(e) => { setPath(e.target.value); setRes(null); }} aria-label="Recurso">{Object.keys(SAMPLE).map((p) => <option key={p}>{p}</option>)}</select>
        <pre className="api-code"><code>{`curl -H "Authorization: Bearer ${token}" \\\n  "https://seu-dominio${path}"`}</code></pre>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setRes(SAMPLE[path])}>Enviar requisição</button>
        {res && <><pre className="api-code"><code>{JSON.stringify(res, null, 2)}</code></pre><small className="muted">Resposta de exemplo: os campos reais podem variar.</small></>}
      </div>
      <div className="dc-stack">
        <strong>Webhook (evento enviado ao seu sistema)</strong>
        <select className="input" value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Evento">{Object.entries(EVENTS).map(([k, t]) => <option key={k} value={k}>{t} ({k})</option>)}</select>
        <pre className="api-code"><code>{`POST https://sua-url-https/webhook\nX-DM-Signature: sha256=9f2c...\n\n${JSON.stringify({ event, data: { id: 101 } }, null, 2)}`}</code></pre>
        <small className="muted">Valide a assinatura HMAC-SHA256 do corpo com o segredo do webhook.</small>
      </div>
    </div>
  );
}

const PROVIDERS = ['Gemini', 'ChatGPT', 'Claude'];
function AiDemo() {
  const [provider, setProvider] = useState('Gemini');
  const [prompt, setPrompt] = useState('Você é a atendente da Studio Aurora. Horário: 9h às 18h. Seja cordial e curta.');
  const [input, setInput] = useState('');
  const [chat, setChat] = useState([]);
  const reply = (m) => {
    const t = m.toLowerCase();
    if (/hor[aá]rio|abre|fecha/.test(t)) return /9h/.test(prompt) ? 'Atendemos das 9h às 18h. Posso ajudar em algo mais?' : 'Não tenho o horário nas minhas instruções. Vou chamar um atendente.';
    if (/pre[cç]o|valor/.test(t)) return 'Posso te enviar a tabela de preços. Qual serviço você procura?';
    return 'Olá! Como posso ajudar você hoje?';
  };
  const send = (e) => { e.preventDefault(); if (!input.trim()) return; setChat([...chat, { me: true, t: input }, { me: false, t: `[${provider}] ${reply(input)}` }]); setInput(''); };
  return (
    <div className="dc-two">
      <div className="dc-stack">
        <div className="dc-chips">{PROVIDERS.map((p) => <button type="button" key={p} className={`btn btn-sm ${provider === p ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setProvider(p)}>{p}</button>)}</div>
        <label className="field"><span>Instruções do agente</span><textarea className="input" rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label>
        <small className="muted">A resposta abaixo é simulada. No sistema, ela vem do provedor escolhido.</small>
      </div>
      <div className="dc-stack">
        <div className="dc-chat">{chat.length ? chat.map((c, i) => <div key={i} className={`dc-bubble ${c.me ? 'me' : ''}`}>{c.t}</div>) : <p className="muted small">Teste: pergunte "qual o horário?" ou "qual o preço?".</p>}</div>
        <form className="dc-inline" onSubmit={send}><input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Mensagem do cliente" aria-label="Mensagem" /><button className="btn btn-primary btn-sm">Enviar</button></form>
      </div>
    </div>
  );
}

const TABS = ['WhatsApp', 'Clientes', 'Cobranças', 'Contratos', 'Auditoria'];
function ProfileDemo() {
  const [protectedTabs, setProtectedTabs] = useState(['Contratos']);
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const toggle = (t) => setProtectedTabs((c) => (c.includes(t) ? c.filter((x) => x !== t) : [...c, t]));
  const unlock = (e) => { e.preventDefault(); if (pin === '1234') { setUnlocked(true); setErr(''); } else setErr('PIN incorreto (use 1234 neste exemplo).'); setPin(''); };
  const visible = TABS.filter((t) => unlocked || !protectedTabs.includes(t));
  return (
    <div className="dc-two">
      <div className="dc-stack">
        <strong className="small">Abas protegidas por PIN</strong>
        {TABS.map((t) => <label key={t} className="small"><input type="checkbox" checked={protectedTabs.includes(t)} onChange={() => toggle(t)} /> {t}</label>)}
      </div>
      <div className="dc-stack">
        <div className="dc-menu">{visible.map((t) => <span key={t} className={protectedTabs.includes(t) ? 'is-protected' : ''}>{t}</span>)}</div>
        {unlocked
          ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUnlocked(false)}>🔒 Esconder abas protegidas</button>
          : <form className="dc-inline" onSubmit={unlock}><input className="input" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="PIN" aria-label="PIN" /><button className="btn btn-primary btn-sm" disabled={!pin}>Desbloquear</button></form>}
        {err && <small style={{ color: 'var(--red-d)' }}>{err}</small>}
      </div>
    </div>
  );
}

export const DEMOS = {
  whatsapp: WhatsAppDemo, clientes: ClientsDemo, cobrancas: ChargesDemo, contratos: ContractsDemo, auditoria: AuditDemo,
  portfolio: PortfolioDemo, produtos: ProductsDemo, pedidos: OrdersDemo, api: ApiDemo, ia: AiDemo, perfil: ProfileDemo,
};
