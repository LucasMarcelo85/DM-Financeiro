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

export function selectDiscountPriceOption(options, isEligible, basePriceCents = 0) {
  if (!(basePriceCents > 0)) return null;
  return selectPriceOption((options || []).filter((option) => option.priceCents > 0), isEligible);
}

export function upcomingPriceTiers(options, { productQuantity = 0, cartQuantity = 0, cartSubtotalCents = 0 } = {}) {
  return (options || []).flatMap((option) => {
    if (!(option.priceCents > 0)) return [];
    if (option.scope === 'cart_value') {
      const remaining = Math.max(0, (option.minCartCents || 0) - cartSubtotalCents);
      return remaining ? [{ ...option, remaining }] : [];
    }
    const quantity = option.scope === 'cart_quantity' ? cartQuantity : productQuantity;
    const remaining = Math.max(0, (option.minQuantity || 1) - quantity);
    return remaining ? [{ ...option, remaining }] : [];
  });
}
