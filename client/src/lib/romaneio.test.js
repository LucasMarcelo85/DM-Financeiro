import assert from 'node:assert/strict';
import test from 'node:test';
import { rowsFromOrder } from './romaneio.js';

test('finds the order product and variation photo when IDs are serialized as strings', () => {
  const productMap = new Map([['5', {
    id: 5,
    images: [{ id: 7, url: '/variation.jpg' }],
  }]]);
  const [row] = rowsFromOrder({ items: [{ productId: '5', imageId: '7' }] }, productMap);

  assert.equal(row.photo, '/variation.jpg');
});

test('builds the public image URL when an order has an image ID but no matching product', () => {
  const [row] = rowsFromOrder({ items: [{ productId: '5', imageId: '7' }] }, new Map());

  assert.equal(row.photo, '/api/public/product-image/7');
});
