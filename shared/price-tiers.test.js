import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPriceOption, upcomingPriceTiers } from './price-tiers.js';

test('keeps the base price available below a wholesale quantity threshold', () => {
  const wholesale = { scope: 'same_product', minQuantity: 8, priceCents: 2000 };
  const selected = selectPriceOption([wholesale], (option) => 1 >= option.minQuantity);
  const basePrice = 3000;
  assert.equal(selected?.priceCents ?? basePrice, basePrice);
});

test('selects the highest reached threshold even when tiers are out of order', () => {
  const wholesale = { scope: 'same_product', minQuantity: 8, priceCents: 2000 };
  const retailBulk = { scope: 'same_product', minQuantity: 3, priceCents: 2500 };
  assert.equal(
    selectPriceOption([wholesale, retailBulk], (option) => option.minQuantity <= 8),
    wholesale,
  );
});

test('uses the single-unit price at quantity one and wholesale at its threshold', () => {
  const wholesale = { scope: 'cart_quantity', minQuantity: 8, priceCents: 2000 };
  const retail = { scope: 'cart_quantity', minQuantity: 1, priceCents: 3000 };
  const options = [wholesale, retail];

  assert.equal(selectPriceOption(options, (option) => option.minQuantity <= 1), retail);
  assert.equal(selectPriceOption(options, (option) => option.minQuantity <= 8), wholesale);
});

test('returns every future product and cart tier with the remaining amount', () => {
  const tiers = upcomingPriceTiers([
    { id: 1, scope: 'same_product', minQuantity: 3, priceCents: 900 },
    { id: 2, scope: 'cart_quantity', minQuantity: 4, priceCents: 800 },
    { id: 3, scope: 'cart_value', minCartCents: 5000, priceCents: 700 },
    { id: 4, scope: 'same_product', minQuantity: 5, priceCents: 600 },
    { id: 5, scope: 'cart_value', minCartCents: 2000, priceCents: 500 },
    { id: 6, scope: 'same_product', minQuantity: 2, priceCents: null },
  ], { productQuantity: 1, cartQuantity: 2, cartSubtotalCents: 2500 });

  assert.deepEqual(tiers.map(({ id, remaining }) => [id, remaining]), [
    [1, 2],
    [2, 2],
    [3, 2500],
    [4, 4],
  ]);
});
