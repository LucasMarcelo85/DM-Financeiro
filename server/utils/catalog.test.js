import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanProduct, MAX_PRODUCT_IMAGES, MAX_PRODUCT_VARIATIONS } from './catalog.js';

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

test('accepts a main image URL during product import', () => {
  const product = cleanProduct({
    name: 'Camiseta',
    category: 'Roupas',
    priceCents: 3000,
    mainImageUrl: 'https://example.com/camiseta.jpg',
  });

  assert.equal(product.images.length, 1);
  assert.equal(product.images[0].externalUrl, 'https://example.com/camiseta.jpg');
  assert.equal(product.images[0].isPrimary, true);
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

test('allows many photo-free variations while keeping a separate image limit', () => {
  const variations = Array.from({ length: 24 }, (_, index) => ({
    color: `Cor ${index}`,
    size: index % 2 ? 'M' : 'G',
  }));
  const product = cleanProduct({
    name: 'Camiseta',
    category: 'Roupas',
    priceCents: 3000,
    mainImage: null,
    images: variations,
  });

  assert.equal(product.images.length, variations.length);
  assert.throws(() => cleanProduct({
    name: 'Camiseta',
    category: 'Roupas',
    priceCents: 3000,
    mainImage: null,
    images: Array.from({ length: MAX_PRODUCT_IMAGES + 1 }, (_, index) => ({
      url: `https://example.com/${index}.jpg`,
      color: `Cor ${index}`,
    })),
  }), /imagens no produto/);
});

test('limits product variations to a safe maximum', () => {
  assert.throws(() => cleanProduct({
    name: 'Camiseta',
    category: 'Roupas',
    priceCents: 3000,
    mainImage: null,
    images: Array.from({ length: MAX_PRODUCT_VARIATIONS + 1 }, (_, index) => ({
      color: `Cor ${index}`,
    })),
  }), /variações no produto/);
});

test('does not count existing photo-free variations against the photo limit', () => {
  const variations = Array.from({ length: 24 }, (_, index) => ({
    id: index + 1,
    color: `Cor ${index}`,
  }));
  const product = cleanProduct({
    name: 'Camiseta',
    category: 'Roupas',
    priceCents: 3000,
    mainImage: null,
    images: variations,
  }, {
    existingImages: variations.map(({ id }) => ({ id, mime: null, externalUrl: null })),
  });

  assert.equal(product.images.length, variations.length);
});
