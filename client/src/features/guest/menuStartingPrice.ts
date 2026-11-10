import type { Product } from './ProductDetailModal';

export function menuStartingPrice(product: Product): number {
  const prices = product.variants
    .filter(
      (variant) =>
        variant.isAvailable !== false && product.allowedOptions.sizes.includes(variant.name),
    )
    .map((variant) => variant.price);
  return prices.length ? Math.min(...prices) : product.basePrice;
}
