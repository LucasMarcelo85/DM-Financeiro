import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanPortfolioDoc } from './portfolio.js';

test('preserves catalog card color-swatch and price-option settings when saving the page', () => {
  const doc = cleanPortfolioDoc({
    v: 2,
    kind: 'catalog',
    catalog: { card: { showColorSwatches: true, showTiers: true } },
    elements: [],
  }, 'catalog');

  assert.equal(doc.catalog.card.showColorSwatches, true);
  assert.equal(doc.catalog.card.showTiers, true);
});
