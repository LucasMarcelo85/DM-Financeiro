import assert from 'node:assert/strict';
import test from 'node:test';
import { colorHexForName, normalizeProductColorName, PRODUCT_COLOR_SUGGESTIONS, PRODUCT_COLOR_VARIATION_SUGGESTIONS } from './productColors.js';

test('recognizes color names with accent, hyphen, and gender variations', () => {
  assert.equal(colorHexForName('AZUL-MARINHO'), colorHexForName('azul marinha'));
  assert.equal(colorHexForName('Roxo escuro'), colorHexForName('Roxa escura'));
  assert.equal(colorHexForName('Vermelho'), colorHexForName('Vermelha'));
  assert.equal(colorHexForName('Cinza claro'), colorHexForName('Cinza clara'));
  assert.equal(normalizeProductColorName('Azul-marinha'), 'azul marinho');
});

test('recognizes and suggests common clothing colors and aliases', () => {
  assert.equal(colorHexForName('Café'), colorHexForName('cafe'));
  assert.equal(colorHexForName('Capuccino'), colorHexForName('cappuccino'));
  assert.equal(colorHexForName('Capuccino'), colorHexForName('capciono'));
  for (const color of ['Azul-marinho', 'Vinho', 'Verde militar', 'Off-white', 'Pistache', 'Verde limão']) {
    assert.ok(PRODUCT_COLOR_SUGGESTIONS.includes(color));
  }
  assert.equal(colorHexForName('Caixa fechada'), null);
});

test('offers assorted, varied, and multicolor choices as variation suggestions', () => {
  for (const option of ['Sortido', 'Sortida', 'Variado', 'Variada', 'Variados', 'Variadas', 'Multicolor', 'Estampas variadas']) {
    assert.ok(PRODUCT_COLOR_VARIATION_SUGGESTIONS.includes(option));
  }
});
