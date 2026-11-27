import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCatalogCustomerWhatsApp, formatCatalogOrderNotification } from './catalog-order-messages.js';

const order = {
  code: '107',
  customerName: 'Lucas Marcelo',
  customerPhone: '85991908723',
  deliveryType: 'excursao',
  delivery: { warehouse: 'Galpão Central', address: 'Rua Francisco, 45', city: 'Passaré' },
  items: [{ name: 'Calça com pala', variation: 'Tamanho: M · Cor: AMENDOA', qty: 1, unitCents: 1300, totalCents: 1300 }],
  subtotalCents: 1300,
  shippingCents: 0,
  totalCents: 1300,
  paymentStatus: 'unpaid',
};

test('customer WhatsApp message contains order, item, delivery and payment summary', () => {
  const message = formatCatalogCustomerWhatsApp(order);
  assert.match(message, /NOVO PEDIDO RECEBIDO/);
  assert.match(message, /Pedido Nº: 107/);
  assert.match(message, /Tamanho: M · Cor: AMENDOA/);
  assert.match(message, /Frete: A combinar/);
  assert.match(message, /Aguardando sua confirmação de pagamento!/);
});

test('store notification identifies customer, logistics and the full order total', () => {
  const message = formatCatalogOrderNotification(order, 'new');
  assert.match(message, /WhatsApp: 85991908723/);
  assert.match(message, /Logística: Excursão/);
  assert.match(message, /Endereço: Galpão Central, Rua Francisco, 45, Passaré/);
  assert.match(message, /13,00/);
});
