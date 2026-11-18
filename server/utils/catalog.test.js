import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanProduct } from './catalog.js';

test('preserves an existing primary image when editing a product', () => {
  const product = cleanProduct({
    name: 'Camiseta',
    category: 'Roupas',
    priceCents: 3000,
    mainImage: { id: 12 },
    images: [],
  });

  assert.equal(product.images.length, 1);
  assert.equal(product.images[0].id, 12);
  assert.equal(product.images[0].isPrimary, true);
  assert.equal(product.images[0].upload, undefined);
});
