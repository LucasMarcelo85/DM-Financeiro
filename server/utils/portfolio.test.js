import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanPortfolioDoc } from './portfolio.js';

test('preserves the catalog card color-swatch setting when saving the page', () => {
  const doc = cleanPortfolioDoc({
    v: 2,
    kind: 'catalog',
    catalog: { card: { showColorSwatches: true } },
    elements: [],
  }, 'catalog');

  assert.equal(doc.catalog.card.showColorSwatches, true);
});
