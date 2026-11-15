import type { IngredientDto, RecipeDto } from '@may-cafe/contracts';

/** Món hoặc topping có thể gắn công thức; `effectiveAvailable` đã tính theo tồn kho. */
export interface Target {
  id: string;
  name: string;
  isAvailable: boolean;
  effectiveAvailable: boolean;
  variants?: Array<{ id: string; name: string; isAvailable: boolean; effectiveAvailable: boolean }>;
}
export interface Overview {
  ingredients: IngredientDto[];
  recipes: RecipeDto[];
  products: Target[];
  toppings: Target[];
}
export const selectClass = 'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm';
export const number = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
export const unitLabel = (unit: string) => (unit === 'unit' ? 'đơn vị' : unit);
