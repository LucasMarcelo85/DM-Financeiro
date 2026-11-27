import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanCatalogConfig, cleanProduct, MAX_PRODUCT_IMAGES, MAX_PRODUCT_VARIATIONS, publicCatalogConfig, publicProduct } from './catalog.js';

test('defaults the excursion shipping fee to zero for existing configurations', () => {
  const config = cleanCatalogConfig({ excursion: { enabled: true } });
  assert.equal(config.excursion.fixedCents, 0);
  assert.equal(publicCatalogConfig(config).excursion.fixedCents, 0);
});

test('shares the first exact-color variation image without replacing an explicit image', () => {
  const product = publicProduct({
    id: 1,
    images: [
      { id: 1, position: 0, isPrimary: true, externalUrl: 'https://example.com/main.jpg' },
      { id: 2, position: 1, isPrimary: false, color: 'Azul', externalUrl: 'https://example.com/blue.jpg' },
      { id: 3, position: 2, isPrimary: false, color: 'Azul' },
      { id: 4, position: 3, isPrimary: false, color: 'Azul', externalUrl: 'https://example.com/blue-variant.jpg' },
      { id: 5, position: 4, isPrimary: false, color: 'azul' },
    ],
  });

  assert.equal(product.images[0].url, 'https://example.com/blue.jpg');
  assert.equal(product.images[0].sharedImage, undefined);
  assert.equal(product.images[1].url, 'https://example.com/blue.jpg');
  assert.equal(product.images[1].sharedImage, true);
  assert.equal(product.images[2].url, 'https://example.com/blue-variant.jpg');
  assert.equal(product.images[2].sharedImage, undefined);
  assert.equal(product.images[3].url, null);
});

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
