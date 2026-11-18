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

test('allows a new variation with attributes but no photo', () => {
  const product = cleanProduct({
    name: 'Camiseta',
    category: 'Roupas',
    priceCents: 3000,
    mainImage: { id: 12 },
    images: [{ color: 'Azul', colorHex: '#0000ff', size: 'M' }],
  });

  assert.equal(product.images.length, 2);
  assert.equal(product.images[1].id, undefined);
  assert.equal(product.images[1].upload, undefined);
  assert.equal(product.images[1].externalUrl, undefined);
  assert.equal(product.images[1].label, 'Azul · M');
});

test('still rejects a new variation with neither a photo nor a characteristic', () => {
  assert.throws(() => cleanProduct({
    name: 'Camiseta',
    category: 'Roupas',
    priceCents: 3000,
    mainImage: { id: 12 },
    images: [{}],
  }), /característica para a variação/);
});
