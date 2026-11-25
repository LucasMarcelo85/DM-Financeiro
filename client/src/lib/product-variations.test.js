import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVariationCombinations } from './product-variations.js';

test('builds every color and size combination', () => {
  const result = buildVariationCombinations('Azul-marinho, Preto', 'P, M, G');

  assert.deepEqual(result.combinations, [
    { color: 'Azul-marinho', size: 'P' },
    { color: 'Azul-marinho', size: 'M' },
    { color: 'Azul-marinho', size: 'G' },
    { color: 'Preto', size: 'P' },
    { color: 'Preto', size: 'M' },
    { color: 'Preto', size: 'G' },
  ]);
});

test('skips existing combinations regardless of color case or gender form', () => {
  const result = buildVariationCombinations('Azul-marinho, Preto', 'M', [
    { color: 'Azul marinha', size: 'm' },
  ]);

  assert.deepEqual(result.combinations, [{ color: 'Preto', size: 'M' }]);
  assert.equal(result.skipped, 1);
});

test('rejects combinations that exceed capacity instead of adding a partial set', () => {
  assert.throws(
    () => buildVariationCombinations('Azul, Preto', 'P, M', [], 3),
    /há espaço para 3/,
  );
});
