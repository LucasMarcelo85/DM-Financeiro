import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPriceOption } from './price-tiers.js';

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
