const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const divider = '━━━━━━━━━━━━━━━━━━';

function deliveryDetails(order) {
  const delivery = order.delivery || {};
  const labels = { retirada: 'Retirada na loja', motoboy: 'Motoboy', excursao: 'Excursão', correios: 'Correios' };
  const address = order.deliveryType === 'retirada'
    ? delivery.address || delivery.name
    : order.deliveryType === 'excursao'
      ? [delivery.warehouse, delivery.address, delivery.city, delivery.state].filter(Boolean).join(', ')
      : [
        delivery.street,
        delivery.number,
        delivery.complement,
        delivery.district,
        delivery.city,
        delivery.state,
        delivery.zip ? `CEP ${delivery.zip}` : '',
      ].filter(Boolean).join(', ');
  const logistics = order.deliveryType === 'correios' && delivery.service
    ? `${labels[order.deliveryType]} (${delivery.service})`
    : labels[order.deliveryType] || order.deliveryType || 'Não informado';
  return { logistics, address };
}

function itemLines(order) {
  return (Array.isArray(order.items) ? order.items : []).map((item, index) => [
    `${index + 1}. ${item.name}`,
    item.variation ? `   Variação: ${item.variation}` : '',
    `   Quantidade: ${item.qty}`,
    `   Valor unitário: ${brl(item.unitCents ?? (item.totalCents / item.qty))}`,
    `   Total: ${brl(item.totalCents)}`,
  ].filter(Boolean).join('\n'));
}

function shippingLabel(order) {
  return order.deliveryType === 'excursao' && !order.shippingCents
    ? 'A combinar'
    : brl(order.shippingCents || 0);
}

export function formatCatalogCustomerWhatsApp(order) {
  const { logistics, address } = deliveryDetails(order);
  const items = itemLines(order);
  return [
    '🛍️ NOVO PEDIDO RECEBIDO!',
    `Pedido Nº: ${order.code}`,
    `Cliente: ${order.customerName}`,
    `Telefone: ${order.customerPhone}`,
    '',
    divider,
    '📦 ITENS DO PEDIDO',
    divider,
    ...items,
    '',
    divider,
    '🚚 ENTREGA',
    divider,
    `Método: ${logistics}`,
    address ? `Endereço: ${address}` : '',
    '',
    divider,
    '💰 RESUMO FINANCEIRO',
    divider,
    `Subtotal: ${brl(order.subtotalCents)}`,
    `Frete: ${shippingLabel(order)}`,
    `Total: ${brl(order.totalCents)}`,
    order.paymentStatus === 'paid' ? 'Pagamento confirmado.' : 'Aguardando sua confirmação de pagamento!',
    order.notes ? `Observações: ${order.notes}` : '',
  ].filter((line) => line !== '').join('\n');
}

export function formatCatalogOrderNotification(order, event) {
  if (event === 'paid') {
    return [
      '✅ PEDIDO PAGO',
      `Pedido: #${order.code}`,
      `Cliente: ${order.customerName}`,
      `Total: ${brl(order.totalCents)}`,
      order.paymentId ? `ID do pagamento: ${order.paymentId}` : '',
    ].filter(Boolean).join('\n');
  }
  const { logistics, address } = deliveryDetails(order);
  return [
    '🛍️ NOVO PEDIDO RECEBIDO',
    '',
    `📦 Pedido: #${order.code}`,
    `👤 Cliente: ${order.customerName}`,
    `📱 WhatsApp: ${order.customerPhone}`,
    `🚚 Logística: ${logistics}`,
    address ? `📍 Endereço: ${address}` : '',
    '',
    divider,
    'ITENS DO PEDIDO',
    divider,
    ...itemLines(order),
    '',
    divider,
    `Subtotal: ${brl(order.subtotalCents)}`,
    `Frete: ${shippingLabel(order)}`,
    `Total: ${brl(order.totalCents)}`,
    order.paymentStatus === 'paid' ? 'Pagamento confirmado.' : order.paymentStatus === 'pending' ? 'Pagamento online pendente.' : 'Aguardando confirmação do pagamento.',
  ].filter((line) => line !== '').join('\n');
}
