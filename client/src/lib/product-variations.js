import { MAX_PRODUCT_VARIATIONS } from '../../../shared/product-limits.js';
import { normalizeProductColorName } from './productColors.js';

function parseValues(value, kind) {
  const entries = new Map();
  for (const raw of String(value || '').split(/[,;\n]/)) {
    const label = raw.replace(/\s+/g, ' ').trim();
    if (!label) continue;
    if (label.length > 20) throw new Error(`Cada ${kind} pode ter no máximo 20 caracteres.`);
    const normalized = kind === 'cor'
      ? normalizeProductColorName(label)
      : label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
    if (!entries.has(normalized)) entries.set(normalized, label);
  }
  return [...entries.values()];
}

function variationKey(color, size) {
  const normalizedSize = String(size || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  return `${normalizeProductColorName(color)}\u0000${normalizedSize}`;
}

export function buildVariationCombinations(colorInput, sizeInput, existing = [], maxVariations = MAX_PRODUCT_VARIATIONS) {
  const colors = parseValues(colorInput, 'cor');
  const sizes = parseValues(sizeInput, 'tamanho');
  if (!colors.length && !sizes.length) throw new Error('Informe pelo menos uma cor ou um tamanho.');

  const colorOptions = colors.length ? colors : [''];
  const sizeOptions = sizes.length ? sizes : [''];
  const known = new Set(existing.map((variation) => variationKey(variation.color, variation.size)));
  const combinations = [];
  let skipped = 0;

  for (const color of colorOptions) {
    for (const size of sizeOptions) {
      const key = variationKey(color, size);
      if (known.has(key)) {
        skipped += 1;
        continue;
      }
      known.add(key);
      combinations.push({ color, size });
    }
  }

  const available = Math.max(0, maxVariations - existing.length);
  if (combinations.length > available) {
    throw new Error(`Essas combinações geram ${combinations.length} novas variações, mas há espaço para ${available}. Remova alguns valores ou variações.`);
  }
  if (!combinations.length) throw new Error('Todas as combinações informadas já existem.');
  return { combinations, skipped };
}
