import { prisma } from '../server/prisma.js';
import { cleanPortfolioDoc } from '../server/utils/portfolio.js';

const ADMIN_ID = 1;
const CONFIRM_FLAG = '--confirm-admin-demo-seed';
const DEMO_MARKER = '[DEMO admin 1]';

const billingClients = [
  'Ana Souza', 'Bruno Lima', 'Carla Mendes', 'Daniel Oliveira', 'Eduarda Costa',
  'Felipe Santos', 'Gabriela Rocha', 'Henrique Alves', 'Isabela Martins', 'Joao Ribeiro',
  'Karen Barros', 'Lucas Carvalho', 'Mariana Nunes', 'Nicolas Ferreira', 'Olivia Gomes',
  'Paulo Azevedo', 'Rafaela Dias', 'Samuel Moreira', 'Tatiane Freitas', 'Vitor Cardoso',
];

const buyerRegions = [
  ['11', 'Sao Paulo', 'SP'], ['21', 'Rio de Janeiro', 'RJ'], ['31', 'Belo Horizonte', 'MG'],
  ['41', 'Curitiba', 'PR'], ['51', 'Porto Alegre', 'RS'], ['61', 'Brasilia', 'DF'],
  ['71', 'Salvador', 'BA'], ['81', 'Recife', 'PE'], ['85', 'Fortaleza', 'CE'],
  ['91', 'Belem', 'PA'], ['27', 'Vitoria', 'ES'], ['48', 'Florianopolis', 'SC'],
  ['62', 'Goiania', 'GO'], ['84', 'Natal', 'RN'], ['98', 'Sao Luis', 'MA'],
  ['79', 'Aracaju', 'SE'], ['83', 'Joao Pessoa', 'PB'], ['92', 'Manaus', 'AM'],
  ['65', 'Cuiaba', 'MT'], ['67', 'Campo Grande', 'MS'],
];

const storeDefinitions = [
  {
    name: 'Loja demonstracao Aurora',
    slug: `demo-aurora-admin-${ADMIN_ID}`,
    portfolioSlug: `site-aurora-demo-admin-${ADMIN_ID}`,
    pageName: 'Site da Loja Aurora',
    heading: 'Aurora: escolhas para o seu dia',
    subtitle: 'Conheca nossos produtos, acompanhe seus pedidos e fale com a equipe.',
    products: [
      ['Bolsa Urbana', 'Acessorios', 18990], ['Carteira Compacta', 'Acessorios', 7990],
      ['Oculos Solar', 'Acessorios', 12990], ['Mochila Essencial', 'Bolsas', 23990],
      ['Cinto Classico', 'Acessorios', 8990], ['Relogio Minimalista', 'Acessorios', 29990],
      ['Colar Dourado', 'Joias', 11990], ['Brinco Argola', 'Joias', 6990],
      ['Necessaire Viagem', 'Bolsas', 8990], ['Chapeu Casual', 'Acessorios', 9990],
      ['Cachecol Leve', 'Vestuário', 10990], ['Pochete Esportiva', 'Bolsas', 13990],
      ['Pulseira Elegante', 'Joias', 5990], ['Porta-cartoes', 'Acessorios', 4990],
      ['Bolsa de Viagem', 'Bolsas', 34990],
    ],
  },
  {
    name: 'Loja demonstracao Casa & Cia',
    slug: `demo-casa-cia-admin-${ADMIN_ID}`,
    portfolioSlug: `site-casa-cia-demo-admin-${ADMIN_ID}`,
    pageName: 'Site da Loja Casa & Cia',
    heading: 'Casa & Cia: conforto em cada detalhe',
    subtitle: 'Produtos para organizar, decorar e aproveitar melhor a sua casa.',
    products: [
      ['Jogo de Toalhas', 'Banho', 15990], ['Kit de Panelas', 'Cozinha', 42990],
      ['Luminaria de Mesa', 'Decoracao', 18990], ['Organizador Multiuso', 'Organizacao', 8990],
      ['Jogo de Cama', 'Quarto', 27990], ['Garrafa Termica', 'Cozinha', 11990],
      ['Almofada Decorativa', 'Decoracao', 7990], ['Prateleira de Parede', 'Organizacao', 14990],
      ['Cesto Organizador', 'Organizacao', 9990], ['Tapete para Sala', 'Decoracao', 32990],
      ['Kit de Potes', 'Cozinha', 12990], ['Manta para Sofa', 'Decoracao', 21990],
      ['Relogio de Parede', 'Decoracao', 17990], ['Escorredor de Loucas', 'Cozinha', 9990],
      ['Suporte para Plantas', 'Jardim', 13990],
    ],
  },
];

function dateOnly(daysFromNow) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date;
}

function portfolioDocument(title, description, kind = 'site') {
  return cleanPortfolioDoc({
    v: 2,
    kind,
    theme: { primary: '#1f55a6', bg: '#ffffff', text: '#14202e', headingFont: 'playfair', bodyFont: 'inter', radius: 'soft', width: 'wide' },
    seo: { title, description },
    elements: [
      {
        t: 'text', id: 'demo-heading', name: 'Titulo principal',
        box: { desktop: { x: 80, y: 120, w: 1100, h: 120, fs: 52 } },
        text: title, font: 'inter', weight: 700, align: 'center', color: '#14202e',
      },
      {
        t: 'text', id: 'demo-description', name: 'Apresentacao',
        box: { desktop: { x: 150, y: 270, w: 960, h: 100, fs: 24 } },
        text: description, font: 'inter', weight: 400, align: 'center', color: '#425466',
      },
    ],
  }, kind);
}

async function getOrCreateStore(tx, userId, definition) {
  const existing = await tx.store.findUnique({ where: { slug: definition.slug } });
  if (existing) {
    if (existing.userId !== userId) throw new Error(`O slug ${definition.slug} ja pertence a outra conta.`);
    return existing;
  }
  return tx.store.create({
    data: { userId, name: definition.name, slug: definition.slug, appEnabled: false },
  });
}

async function ensurePortfolio(tx, userId, storeId, slug, name, heading, subtitle, kind = 'site') {
  const existing = await tx.portfolio.findUnique({ where: { userId_slug: { userId, slug } } });
  if (existing) {
    if (!existing.name.startsWith('DEMO -')) {
      throw new Error(`A pagina ${slug} ja existe e nao parece ser deste seed.`);
    }
    return existing;
  }
  const isMain = await tx.portfolio.count({ where: { userId, storeId, isMain: true } }) === 0;
  return tx.portfolio.create({
    data: {
      userId, storeId, name, slug, kind, published: true, isMain,
      data: portfolioDocument(heading, subtitle, kind),
    },
  });
}

async function ensureContact(tx, userId, index, name) {
  const phone = `551199800${String(index + 1).padStart(4, '0')}`;
  const existing = await tx.contact.findUnique({ where: { userId_phone: { userId, phone } } });
  if (existing && !existing.notes?.includes(DEMO_MARKER)) {
    throw new Error(`O telefone ${phone} ja esta cadastrado sem identificacao de demonstracao.`);
  }
  const contact = existing
    ? await tx.contact.update({ where: { id: existing.id }, data: { name, notes: `${DEMO_MARKER} cliente de cobranca` } })
    : await tx.contact.create({ data: { userId, name, phone, notes: `${DEMO_MARKER} cliente de cobranca` } });

  const amountCents = 15000 + index * 15000;
  const text = `${DEMO_MARKER} Cobranca de demonstracao ${String(index + 1).padStart(2, '0')}`;
  const schedule = await tx.schedule.findFirst({ where: { userId, text } });
  const dueDate = dateOnly(index + 5);
  const scheduleData = {
    userId, contactId: contact.id, kind: 'cobranca', recurrence: 'avulsa', status: 'pausada',
    amountCents, text, dueDate, nextDueDate: null, daysBefore: 0, sendTime: '09:00',
    nextRunAt: null, extra: `${DEMO_MARKER} nao enviar automaticamente`,
  };
  if (schedule) await tx.schedule.update({ where: { id: schedule.id }, data: scheduleData });
  else await tx.schedule.create({ data: scheduleData });
}

async function ensureProduct(tx, userId, storeId, definition) {
  const [name, category, priceCents] = definition;
  const demoName = `${DEMO_MARKER} ${name}`;
  const existing = await tx.product.findFirst({ where: { userId, storeId, name: demoName } });
  const data = {
    userId, storeId, name: demoName, kind: 'produto', category, description: `${DEMO_MARKER} Produto para demonstracao da loja.`,
    priceCents, stockEnabled: false, stockQuantity: 100, active: true,
  };
  if (existing) return tx.product.update({ where: { id: existing.id }, data });
  return tx.product.create({ data });
}

async function ensureStoreBuyers(tx, userId, storeId, storeIndex, products) {
  const scopeKey = `store:${storeId}`;
  for (let index = 0; index < buyerRegions.length; index += 1) {
    const [ddd, city, state] = buyerRegions[index];
    const phone = `55${ddd}${String(900000000 + index + storeIndex * 100).slice(-9)}`;
    const name = billingClients[index];
    const existingProfile = await tx.orderCustomerProfile.findUnique({
      where: { userId_scopeKey_customerPhone: { userId, scopeKey, customerPhone: phone } },
    });
    if (existingProfile && !existingProfile.notes.includes(DEMO_MARKER)) {
      throw new Error(`O perfil de cliente ${phone} ja existe fora deste seed.`);
    }
    await tx.orderCustomerProfile.upsert({
      where: { userId_scopeKey_customerPhone: { userId, scopeKey, customerPhone: phone } },
      create: { userId, scopeKey, customerPhone: phone, customerName: name, notes: `${DEMO_MARKER} comprador da loja` },
      update: { customerName: name, notes: `${DEMO_MARKER} comprador da loja` },
    });

    const product = products[index % products.length];
    const totalCents = product.priceCents;
    const code = `DEMO-${storeIndex + 1}-${String(index + 1).padStart(2, '0')}`;
    const orderDate = new Date(Date.now() - (20 - index) * 86400000);
    const orderData = {
      userId, storeId, code, customerName: name, customerPhone: phone,
      deliveryType: 'motoboy',
      delivery: { street: 'Rua de demonstracao', number: String(index + 1), district: 'Centro', city, state, km: 1.2 },
      items: [{ productId: product.id, name: product.name, qty: 1, unitCents: totalCents, totalCents }],
      subtotalCents: totalCents, shippingCents: 0, totalCents,
      notes: `${DEMO_MARKER} compra feita pelo catalogo`,
      status: 'atendido', stockReserved: false, paymentStatus: 'paid',
      paymentProvider: 'manual', paymentMethod: 'pix',
      paymentBreakdown: [{ method: 'pix', amountCents: totalCents, receivedCents: totalCents }],
      source: 'catalog', paidAt: orderDate, createdAt: orderDate,
    };
    const existingOrder = await tx.order.findFirst({ where: { userId, storeId, code } });
    if (existingOrder && !existingOrder.notes.includes(DEMO_MARKER)) {
      throw new Error(`O codigo de pedido ${code} ja existe fora deste seed.`);
    }
    const order = existingOrder
      ? await tx.order.update({ where: { id: existingOrder.id }, data: orderData })
      : await tx.order.create({ data: orderData });
    await tx.orderStrategyRecord.upsert({
      where: { orderId: order.id },
      create: { orderId: order.id, userId, storeId, customerPhone: phone, totalCents, paid: true, createdAt: orderDate },
      update: { userId, storeId, customerPhone: phone, totalCents, paid: true, createdAt: orderDate },
    });
  }
}

async function seed() {
  if (!process.argv.includes(CONFIRM_FLAG)) {
    throw new Error(`Para gravar os dados, execute novamente com ${CONFIRM_FLAG}.`);
  }

  const admin = await prisma.user.findUnique({ where: { id: ADMIN_ID }, select: { id: true, role: true, portfolioSlug: true } });
  if (!admin || admin.role !== 'admin') throw new Error(`O usuario ${ADMIN_ID} nao existe ou nao e administrador.`);

  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < billingClients.length; index += 1) {
      await ensureContact(tx, ADMIN_ID, index, billingClients[index]);
    }

    const portfolioSlug = admin.portfolioSlug || `demo-admin-${ADMIN_ID}`;
    if (!admin.portfolioSlug) {
      const owner = await tx.user.findUnique({ where: { portfolioSlug }, select: { id: true } });
      if (owner && owner.id !== ADMIN_ID) throw new Error(`O endereco publico ${portfolioSlug} ja esta em uso.`);
      await tx.user.update({ where: { id: ADMIN_ID }, data: { portfolioSlug } });
    }
    await ensurePortfolio(
      tx, ADMIN_ID, null, `portfolio-demo-admin-${ADMIN_ID}`,
      'DEMO - Portfolio de demonstracao', 'Seu negocio em destaque',
      'Apresente seus servicos, produtos e formas de atendimento em uma pagina profissional.',
    );

    for (let storeIndex = 0; storeIndex < storeDefinitions.length; storeIndex += 1) {
      const definition = storeDefinitions[storeIndex];
      const store = await getOrCreateStore(tx, ADMIN_ID, definition);
      const products = [];
      for (let index = 0; index < definition.products.length; index += 1) {
        products.push(await ensureProduct(tx, ADMIN_ID, store.id, definition.products[index]));
      }
      await ensurePortfolio(
        tx, ADMIN_ID, store.id, definition.portfolioSlug, `DEMO - ${definition.pageName}`,
        definition.heading, definition.subtitle, 'catalog',
      );
      await ensureStoreBuyers(tx, ADMIN_ID, store.id, storeIndex, products);
    }
  }, { maxWait: 10000, timeout: 120000 });
}

try {
  await seed();
  console.log('Dados de demonstracao criados/atualizados para o administrador 1.');
} catch (error) {
  console.error(`[seed admin demo] ${error.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
