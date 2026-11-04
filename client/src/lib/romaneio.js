const KEY = 'dm:romaneio:config';

export const COLUMN_DEFS = {
  photo: 'Foto', barcode: 'Código de barras', name: 'Produto', variation: 'Variação', category: 'Categoria',
  qty: 'Qtd', unit: 'Unitário', total: 'Total', check: 'Conferido',
};
export const FIELD_DEFS = {
  store: 'Loja', order: 'Pedido', date: 'Data', customer: 'Cliente', phone: 'Telefone',
  delivery: 'Entrega', payment: 'Pagamento', notes: 'Observações',
};

export function defaultRomaneio() {
  return {
    title: 'Romaneio', paper: 'a4', fontSize: 10, imageSize: 12, barcodeMode: 'both',
    columns: Object.keys(COLUMN_DEFS).map((key) => ({ key, label: COLUMN_DEFS[key], visible: ['photo', 'name', 'variation', 'qty', 'check'].includes(key) })),
    fields: Object.keys(FIELD_DEFS).map((key) => ({ key, label: FIELD_DEFS[key], visible: true })),
    showTotals: true, signatures: true, footer: '',
  };
}

export function loadRomaneio() {
  const base = defaultRomaneio();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!saved) return base;
    const merge = (defaults, list) => {
      const known = new Map((Array.isArray(list) ? list : []).map((item) => [item.key, item]));
      const ordered = [...known.keys()].filter((key) => defaults.some((d) => d.key === key));
      const rest = defaults.filter((d) => !known.has(d.key)).map((d) => d.key);
      return [...ordered, ...rest].map((key) => ({ ...defaults.find((d) => d.key === key), ...(known.get(key) || {}) }));
    };
    return { ...base, ...saved, columns: merge(base.columns, saved.columns), fields: merge(base.fields, saved.fields) };
  } catch { return base; }
}

export const saveRomaneio = (config) => { try { localStorage.setItem(KEY, JSON.stringify(config)); } catch { /* ignora */ } };

export function deliveryText(o) {
  const d = o.delivery || {};
  if (o.deliveryType === 'retirada') return `${d.name || 'Retirada na loja'}${d.address ? ` · ${d.address}` : ''}`;
  if (o.deliveryType === 'excursao') return `Galpão ${d.warehouse || ''} · ${[d.address, d.city].filter(Boolean).join(', ')}`;
  const addr = [d.street, d.number, d.district, d.city && `${d.city}${d.state ? `/${d.state}` : ''}`].filter(Boolean).join(', ');
  const label = o.deliveryType === 'motoboy' ? 'Motoboy' : (d.service || 'Correios');
  return `${label}${addr ? ` · ${addr}` : ''}${d.zip ? ` · CEP ${d.zip}` : ''}`;
}

// Monta as linhas do documento a partir dos itens do pedido e do cadastro de produtos.
export function rowsFromOrder(order, productMap) {
  return (order.items || []).map((item) => {
    const product = productMap.get(item.productId);
    const image = product?.images?.find((i) => i.id === item.imageId);
    const main = product?.mainImage || product?.images?.[0];
    return {
      photo: (image || main)?.url || '',
      code: image?.barcode || product?.barcode || '',
      name: item.name || product?.name || '',
      variation: item.variation || '',
      category: product?.category || '',
      qty: item.qty || 0,
      unitCents: item.unitCents || 0,
      totalCents: item.totalCents ?? (item.unitCents || 0) * (item.qty || 0),
    };
  });
}

export function rowsFromProducts(products) {
  return products.map((product) => {
    const stock = product.images?.length ? product.images.reduce((sum, i) => sum + (i.stockQuantity || 0), 0) : product.stockQuantity || 0;
    const main = product.mainImage || product.images?.[0];
    return {
      photo: main?.url || '', code: product.barcode || '', name: product.name, variation: '', category: product.category || '',
      qty: product.stockEnabled ? stock : 1, unitCents: product.priceCents || 0, totalCents: (product.priceCents || 0) * (product.stockEnabled ? stock : 1),
    };
  });
}
