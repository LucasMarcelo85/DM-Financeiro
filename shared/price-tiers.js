export function selectPriceOption(options, isEligible) {
  const bestByScope = new Map();
  for (const [position, option] of (options || []).entries()) {
    if (option.priceCents === null || option.priceCents === undefined || !isEligible(option)) continue;
    const threshold = option.scope === 'cart_value'
      ? option.minCartCents || 0
      : option.minQuantity || 1;
    const current = bestByScope.get(option.scope);
    if (!current || threshold >= current.threshold) {
      bestByScope.set(option.scope, { option, position, threshold });
    }
  }
  return [...bestByScope.values()].sort((a, b) => a.position - b.position).at(-1)?.option || null;
}
