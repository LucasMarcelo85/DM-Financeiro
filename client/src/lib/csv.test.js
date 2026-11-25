import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCsvRows, stringifyCsv } from './csv.js';

const columns = [
  { key: 'name', type: 'string' },
  { key: 'mainImageUrl', type: 'string', optional: true },
];

test('parses the optional image URL column when present', () => {
  const csv = stringifyCsv(columns, [{ name: 'Camiseta', mainImageUrl: 'https://example.com/camiseta.jpg' }], 'dm-financeiro:products:v1');
  const [product] = parseCsvRows(csv, columns, 'dm-financeiro:products:v1');

  assert.equal(product.mainImageUrl, 'https://example.com/camiseta.jpg');
});

test('continues to parse product CSV files without the optional image URL column', () => {
  const legacyCsv = stringifyCsv(columns.slice(0, 1), [{ name: 'Camiseta' }], 'dm-financeiro:products:v1');
  const [product] = parseCsvRows(legacyCsv, columns, 'dm-financeiro:products:v1');

  assert.equal(product.name, 'Camiseta');
  assert.equal(Object.hasOwn(product, 'mainImageUrl'), false);
});

test('still requires all non-optional CSV columns', () => {
  const csv = stringifyCsv(columns.slice(1), [{ mainImageUrl: 'https://example.com/camiseta.jpg' }], 'dm-financeiro:products:v1');

  assert.throws(() => parseCsvRows(csv, columns, 'dm-financeiro:products:v1'), /colunas deste CSV/);
});
