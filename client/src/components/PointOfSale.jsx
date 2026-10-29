import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';
import { useToast } from './Toast.jsx';
import { brl, centsToMasked, formatStoredPhone, maskMoney, moneyToCents } from '../lib/format.js';

const METHODS = [
  ['dinheiro', 'Dinheiro'],
  ['cartao', 'Cartão'],
  ['pix', 'Pix'],
];
const imageUrl = (image) => image?.url || '';
const eligibleTier = (option, productQty, cartQty, cartCents) => option.scope === 'cart_quantity'
  ? cartQty >= (option.minQuantity || 1)
  : option.scope === 'cart_value'
    ? cartCents >= (option.minCartCents || 0)
    : productQty >= (option.minQuantity || 1);
const tierPrice = (product, cart) => {
  const qty = cart.filter((line) => line.productId === product.id).reduce((sum, line) => sum + line.qty, 0);
  const cartQty = cart.reduce((sum, line) => sum + line.qty, 0);
  const cartCents = cart.reduce((sum, line) => sum + line.baseCents * line.qty, 0);
  return [...(product.priceOptions || [])]
    .filter((option) => option.priceCents !== null && eligibleTier(option, qty, cartQty, cartCents))
    .at(-1) || null;
};

function moneyInput(value, onChange, label) {
  return <input className="input" inputMode="numeric" aria-label={label} value={value} onChange={(event) => onChange(maskMoney(event.target.value))} placeholder="0,00" />;
}

function receiptMarkup(receipt, order) {
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const lines = order.items.map((item) => `<tr><td>${esc(item.qty)}× ${esc(item.name)}${item.variation ? `<small>${esc(item.variation)}</small>` : ''}</td><td>${esc(brl(item.totalCents))}</td></tr>`).join('');
  const payments = (order.paymentBreakdown || []).map((payment) => `<p>${esc(METHODS.find(([method]) => method === payment.method)?.[1] || payment.method)}: ${esc(brl(payment.amountCents))}</p>`).join('');
  return `<!doctype html><html lang="pt-br"><meta charset="utf-8"><title>Comprovante ${esc(order.code)}</title>
  <style>body{font:14px Arial,sans-serif;max-width:360px;margin:20px auto;color:#111}h1,h2,p{text-align:center;margin:5px 0}h1{font-size:20px}.tag{border:1px solid #111;padding:6px;margin:14px 0;text-align:center;font-weight:bold}table{width:100%;border-collapse:collapse;margin:12px 0}td{padding:6px 0;border-bottom:1px dashed #aaa}td:last-child{text-align:right}small{display:block;color:#444}.total{font-weight:bold;font-size:18px;border-top:2px solid #111;padding-top:8px}.muted{color:#555;font-size:12px}@media print{body{margin:0 auto}}</style>
  <body><h1>${esc(receipt.storeName)}</h1>${receipt.document ? `<p>${esc(receipt.document)}</p>` : ''}${receipt.address ? `<p>${esc(receipt.address)}</p>` : ''}${receipt.phone ? `<p>${esc(receipt.phone)}</p>` : ''}
  <div class="tag">COMPROVANTE NÃO FISCAL<br>Não substitui documento fiscal</div><p>Pedido ${esc(order.code)}</p><p>${new Date(order.createdAt).toLocaleString('pt-BR')}</p><p>${esc(order.customerName)}${order.customerPhone ? ` · ${esc(formatStoredPhone(order.customerPhone))}` : ''}</p>
  <table>${lines}</table><p>Subtotal: ${esc(brl(order.subtotalCents))}</p>${order.discountCents ? `<p>Desconto: −${esc(brl(order.discountCents))}</p>` : ''}${order.surchargeCents ? `<p>Acréscimo: +${esc(brl(order.surchargeCents))}</p>` : ''}<p class="total">Total: ${esc(brl(order.totalCents))}</p>${payments}${order.notes ? `<p class="muted">Observações: ${esc(order.notes)}</p>` : ''}${receipt.footer ? `<p>${esc(receipt.footer)}</p>` : ''}<p class="muted">Obrigado pela preferência!</p></body></html>`;
}

export default function PointOfSale({ onClose, allowCustomers = true }) {
  const toast = useToast();
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [selection, setSelection] = useState(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [discount, setDiscount] = useState('');
  const [surcharge, setSurcharge] = useState('');
  const [method, setMethod] = useState('dinheiro');
  const [mixedFirst, setMixedFirst] = useState('dinheiro');
  const [mixedSecond, setMixedSecond] = useState('pix');
  const [mixedAmount, setMixedAmount] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [receiptForm, setReceiptForm] = useState(null);
  const [lastOrder, setLastOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  const loadProducts = useCallback(() => api.get('/products').then((result) => {
    setProducts((result.products || []).filter((product) => product.active));
  }).catch((error) => toast(error.message, 'error')), [toast]);
  useEffect(() => {
    loadProducts();
    api.get('/catalog/pos/settings').then((result) => setReceipt(result.receipt)).catch((error) => toast(error.message, 'error'));
  }, [loadProducts, toast]);

  const visibleProducts = products.filter((product) => `${product.name} ${product.category}`.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')));
  const subtotalCents = cart.reduce((sum, line) => sum + line.unitCents * line.qty, 0);
  const discountCents = moneyToCents(discount);
  const surchargeCents = moneyToCents(surcharge);
  const totalCents = Math.max(0, subtotalCents - discountCents + surchargeCents);
  const cartCount = cart.reduce((sum, line) => sum + line.qty, 0);
  const cashValue = moneyToCents(cashReceived);
  const splitFirstCents = moneyToCents(mixedAmount);
  const paymentBreakdown = useMemo(() => {
    if (method !== 'misto') return [{ method, amountCents: totalCents, receivedCents: method === 'dinheiro' ? Math.max(totalCents, cashValue) : totalCents }];
    return [
      { method: mixedFirst, amountCents: splitFirstCents, receivedCents: mixedFirst === 'dinheiro' ? cashValue : splitFirstCents },
      { method: mixedSecond, amountCents: Math.max(0, totalCents - splitFirstCents), receivedCents: mixedSecond === 'dinheiro' ? Math.max(0, totalCents - splitFirstCents, cashValue) : Math.max(0, totalCents - splitFirstCents) },
    ];
  }, [method, totalCents, cashValue, mixedFirst, mixedSecond, splitFirstCents]);
  const splitInvalid = method === 'misto' && (splitFirstCents < 1 || splitFirstCents >= totalCents || mixedFirst === mixedSecond);
  const changeCents = paymentBreakdown.filter((payment) => payment.method === 'dinheiro').reduce((sum, payment) => sum + Math.max(0, payment.receivedCents - payment.amountCents), 0);

  function chooseProduct(product) {
    const variations = product.images || [];
    if (variations.length || product.priceOptions?.some((option) => option.priceCents !== null)) {
      setSelection({ product, imageId: variations.length ? variations[0].id : null, priceOptionId: null });
      return;
    }
    addToCart(product, null, null);
  }

  function addToCart(product, imageId, priceOptionId) {
    const image = (product.images || []).find((row) => row.id === imageId) || null;
    const variations = (product.images || []).length > 0;
    const baseCents = image?.priceCents ?? product.priceCents;
    const qtyInCart = cart.filter((line) => line.productId === product.id && line.imageId === imageId && line.priceOptionId === priceOptionId).reduce((sum, line) => sum + line.qty, 0);
    const stock = image?.stockQuantity ?? product.stockQuantity;
    if (product.stockEnabled && qtyInCart + 1 > stock) {
      toast('Estoque insuficiente para essa opção.', 'error');
      return;
    }
    const tier = priceOptionId ? product.priceOptions.find((option) => option.id === priceOptionId) : tierPrice(product, cart);
    const unitCents = tier?.priceCents ?? baseCents;
    const key = `${product.id}-${image?.id || 'product'}-${tier?.id || 'base'}`;
    const variation = image ? [image.label, image.size, image.color].filter(Boolean).join(' · ') : '';
    setCart((current) => {
      const found = current.find((line) => line.key === key);
      if (found) return current.map((line) => line.key === key ? { ...line, qty: line.qty + 1, unitCents } : line);
      return [...current, {
        key, productId: product.id, imageId: variations ? image?.id : null, priceOptionId: tier?.id || null,
        name: product.name, variation, qty: 1, unitCents, baseCents, stockEnabled: Boolean(product.stockEnabled), stock,
      }];
    });
    setSelection(null);
    setCartOpen(true);
  }

  function changeQty(key, delta) {
    setCart((current) => current.map((line) => {
      if (line.key !== key) return line;
      const qty = line.qty + delta;
      if (qty < 1) return line;
      if (line.stockEnabled && qty > line.stock) {
        toast('Estoque insuficiente para essa opção.', 'error');
        return line;
      }
      return { ...line, qty };
    }));
  }

  async function saveReceipt() {
    try {
      const result = await api.put('/catalog/pos/settings', { receipt: receiptForm });
      setReceipt(result.receipt);
      setReceiptForm(null);
      toast('Configuração do comprovante salva.');
    } catch (error) { toast(error.message, 'error'); }
  }

  async function checkout() {
    if (!cart.length) return toast('Adicione produtos ao carrinho.', 'error');
    if (discountCents > subtotalCents) return toast('O desconto não pode superar o subtotal.', 'error');
    if (method === 'misto' && splitInvalid) return toast('Confira os valores e formas do pagamento misto.', 'error');
    if (paymentBreakdown.some((payment) => payment.amountCents < 1 || payment.receivedCents < payment.amountCents)) return toast('Confira os valores recebidos.', 'error');
    if (method === 'dinheiro' && cashReceived && cashValue < totalCents) return toast('O valor recebido é menor que o total.', 'error');
    setBusy(true);
    try {
      const result = await api.post('/catalog/pos/checkout', {
        items: cart.map((line) => ({ productId: line.productId, imageId: line.imageId, priceOptionId: line.priceOptionId, qty: line.qty })),
        customerName, customerPhone, notes, discountCents, surchargeCents, payments: paymentBreakdown,
      });
      setLastOrder(result.order);
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setNotes('');
      setDiscount('');
      setSurcharge('');
      setCashReceived('');
      setMixedAmount('');
      setCartOpen(false);
      loadProducts();
      if (receipt?.enabled) toast('Venda finalizada. Deseja imprimir o comprovante não fiscal?', 'success');
      else toast('Venda finalizada.');
    } catch (error) { toast(error.message, 'error'); } finally { setBusy(false); }
  }

  function printReceipt(order) {
    if (!receipt?.enabled) return;
    const popup = window.open('', '_blank', 'width=420,height=720');
    if (!popup) {
      toast('Permita janelas pop-up para imprimir o comprovante.', 'error');
      return;
    }
    popup.onload = () => popup.print();
    popup.document.open();
    popup.document.write(receiptMarkup(receipt, order));
    popup.document.close();
  }

  function changeMethod(value) {
    setMethod(value);
    if (value === 'misto') setMixedAmount(centsToMasked(Math.floor(totalCents / 2)));
    else if (value === 'dinheiro') setCashReceived('');
  }

  function renderCart() {
    return (
      <>
        <div className="pos-cart-lines">
          {!cart.length ? <p className="muted">Escolha produtos para iniciar a venda.</p> : cart.map((line) => (
            <article className="pos-cart-line" key={line.key}>
              <div><strong>{line.name}</strong>{line.variation && <small>{line.variation}</small>}<small>{brl(line.unitCents)} cada</small></div>
              <div className="pos-line-actions">
                <button type="button" className="pos-qty-btn" onClick={() => changeQty(line.key, -1)} aria-label={`Diminuir ${line.name}`}>−</button>
                <strong>{line.qty}</strong>
                <button type="button" className="pos-qty-btn" onClick={() => changeQty(line.key, 1)} aria-label={`Aumentar ${line.name}`}>+</button>
                <button type="button" className="pos-remove" onClick={() => setCart((items) => items.filter((item) => item.key !== line.key))} aria-label={`Remover ${line.name}`}>×</button>
              </div>
              <b>{brl(line.unitCents * line.qty)}</b>
            </article>
          ))}
        </div>
        <div className="pos-checkout-fields">
          <label>Cliente (opcional)
            <input className="input" value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Consumidor final" maxLength={120} />
          </label>
          {allowCustomers && <label>Telefone do cliente
            <input className="input" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="DDD + telefone" inputMode="tel" maxLength={20} />
          </label>}
          <label>Observações do pedido
            <textarea className="input" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={2} placeholder="Opcional" />
          </label>
          <div className="pos-adjustments">
            <label>Desconto {moneyInput(discount, setDiscount, 'Valor do desconto')}</label>
            <label>Acréscimo {moneyInput(surcharge, setSurcharge, 'Valor do acréscimo')}</label>
          </div>
          <label>Forma de pagamento
            <select className="input" value={method} onChange={(event) => changeMethod(event.target.value)}>
              {METHODS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              <option value="misto">Pagamento misto</option>
            </select>
          </label>
          {method === 'misto' ? (
            <div className="pos-mixed">
              <label>Primeira forma
                <select className="input" value={mixedFirst} onChange={(event) => setMixedFirst(event.target.value)}>{METHODS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
              </label>
              <label>Valor da primeira forma {moneyInput(mixedAmount, setMixedAmount, 'Valor da primeira forma de pagamento')}</label>
              <label>Segunda forma
                <select className="input" value={mixedSecond} onChange={(event) => setMixedSecond(event.target.value)}>{METHODS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
              </label>
              <p className="muted">Restante: {brl(Math.max(0, totalCents - splitFirstCents))}</p>
            </div>
          ) : method === 'dinheiro' ? (
            <label>Valor recebido (opcional)
              {moneyInput(cashReceived, setCashReceived, 'Valor recebido em dinheiro')}
            </label>
          ) : null}
          <div className="pos-total"><span>Subtotal</span><strong>{brl(subtotalCents)}</strong></div>
          {discountCents > 0 && <div className="pos-total"><span>Desconto</span><strong>− {brl(discountCents)}</strong></div>}
          {surchargeCents > 0 && <div className="pos-total"><span>Acréscimo</span><strong>+ {brl(surchargeCents)}</strong></div>}
          <div className="pos-total pos-grand-total"><span>Total</span><strong>{brl(totalCents)}</strong></div>
          {changeCents > 0 && <p className="pos-change">Troco: {brl(changeCents)}</p>}
          <button type="button" className="btn btn-primary pos-finish" onClick={checkout} disabled={busy || !cart.length}>{busy ? 'Finalizando...' : `Finalizar venda · ${brl(totalCents)}`}</button>
        </div>
      </>
    );
  }

  return (
    <section className="pos-page">
      <header className="pos-header">
        <div>{onClose && <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>← Voltar</button>}<div><h1>Frente de caixa</h1><p className="muted">Venda rápida, estoque atualizado automaticamente.</p></div></div>
        <div className="pos-header-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setReceiptForm({ ...receipt })}>Comprovante</button><button type="button" className="btn btn-primary pos-mobile-cart" onClick={() => setCartOpen(true)}>Carrinho · {cartCount}</button></div>
      </header>
      <div className="pos-layout">
        <section className="pos-products-panel">
          <div className="pos-products-head"><h2>Produtos</h2><input className="input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar produto ou categoria" aria-label="Buscar produtos do PDV" /></div>
          {!visibleProducts.length ? <div className="empty-hero"><h2>Nenhum produto disponível</h2><p>Cadastre e ative produtos para vender no caixa.</p></div> : (
            <div className="pos-product-grid">
              {visibleProducts.map((product) => {
                const image = product.mainImage || product.images?.[0];
                const tier = tierPrice(product, cart);
                const unit = tier?.priceCents ?? image?.priceCents ?? product.priceCents;
                const unavailable = product.stockEnabled && product.stockQuantity < 1 && !(product.images || []).some((variant) => variant.stockQuantity > 0);
                return (
                  <button type="button" className="pos-product-card" key={product.id} onClick={() => chooseProduct(product)} disabled={unavailable}>
                    <span className="pos-product-image">{imageUrl(image) ? <img src={imageUrl(image)} alt="" loading="lazy" /> : <span>{product.name.slice(0, 1).toUpperCase()}</span>}</span>
                    <span className="pos-product-name">{product.name}</span>
                    <span className="pos-product-category">{product.category}</span>
                    <strong>{unit > 0 ? brl(unit) : 'Preço não informado'}</strong>
                    {product.stockEnabled && <small>{unavailable ? 'Sem estoque' : `${product.stockQuantity} em estoque`}</small>}
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <aside className={`pos-cart-panel${cartOpen ? ' is-mobile-open' : ''}`}>
          <div className="pos-cart-head"><h2>Venda atual</h2><button className="pos-cart-close" type="button" onClick={() => setCartOpen(false)} aria-label="Fechar carrinho">×</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCart([]); setCartOpen(false); }}>Limpar</button></div>
          {renderCart()}
        </aside>
      </div>
      {selection && (
        <Modal title={`Adicionar ${selection.product.name}`} onClose={() => setSelection(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setSelection(null)}>Cancelar</button><button className="btn btn-primary" onClick={() => addToCart(selection.product, selection.imageId, selection.priceOptionId)}>Adicionar ao carrinho</button></>}>
          <div className="pos-option-list">
            {(selection.product.images || []).length > 0 && <label>Variação
              <select className="input" value={selection.imageId || ''} onChange={(event) => setSelection((current) => ({ ...current, imageId: Number(event.target.value) }))}>
                {(selection.product.images || []).map((image) => <option key={image.id} value={image.id}>{[image.label, image.size, image.color].filter(Boolean).join(' · ') || 'Opção'} · {brl(image.priceCents ?? selection.product.priceCents)}{selection.product.stockEnabled ? ` · estoque ${image.stockQuantity}` : ''}</option>)}
              </select>
            </label>}
            {(selection.product.priceOptions || []).some((option) => option.priceCents !== null) && <label>Preço especial
              <select className="input" value={selection.priceOptionId || ''} onChange={(event) => setSelection((current) => ({ ...current, priceOptionId: event.target.value ? Number(event.target.value) : null }))}>
                <option value="">Preço padrão</option>
                {selection.product.priceOptions.filter((option) => option.priceCents !== null).map((option) => <option value={option.id} key={option.id}>{option.label} · {brl(option.priceCents)}</option>)}
              </select>
            </label>}
          </div>
        </Modal>
      )}
      {receiptForm && <Modal title="Comprovante não fiscal" onClose={() => setReceiptForm(null)}
        footer={<><button className="btn btn-ghost" onClick={() => setReceiptForm(null)}>Cancelar</button><button className="btn btn-primary" onClick={saveReceipt}>Salvar</button></>}>
        <p className="muted">Este comprovante não é nota fiscal e não substitui documento fiscal.</p>
        <label className="pos-check"><input type="checkbox" checked={receiptForm.enabled} onChange={(event) => setReceiptForm((value) => ({ ...value, enabled: event.target.checked }))} /> Oferecer impressão ao finalizar uma venda</label>
        {['storeName', 'document', 'address', 'phone', 'footer'].map((field) => <label className="pos-receipt-field" key={field}>{({ storeName: 'Nome da loja', document: 'Documento', address: 'Endereço', phone: 'Telefone', footer: 'Mensagem final' })[field]}<input className="input" value={receiptForm[field] || ''} onChange={(event) => setReceiptForm((value) => ({ ...value, [field]: event.target.value }))} maxLength={field === 'footer' ? 300 : 240} /></label>)}
      </Modal>}
      {lastOrder && <Modal title="Venda finalizada" onClose={() => setLastOrder(null)}
        footer={<><button className="btn btn-ghost" onClick={() => setLastOrder(null)}>Fechar</button>{receipt?.enabled && <button className="btn btn-primary" onClick={() => printReceipt(lastOrder)}>Imprimir comprovante</button>}</>}>
        <p>Pedido <strong>#{lastOrder.code}</strong> · {brl(lastOrder.totalCents)}</p>
        {receipt?.enabled ? <p>Deseja imprimir o comprovante não fiscal?</p> : <p className="muted">Configure um comprovante não fiscal para disponibilizar a impressão.</p>}
      </Modal>}
    </section>
  );
}
