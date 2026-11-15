import { describe, expect, it } from 'vitest';
import {
  EMPTY_FORM,
  buildProductPayload,
  formFromProduct,
  mergeSuggestedTags,
  normalizeProductName,
  parseTags,
  type AdminProduct,
} from '../features/admin/products/model';

const product: AdminProduct = {
  _id: 'p1',
  categoryId: 'c1',
  name: 'Cà phê Sữa Đá',
  description: 'Cà phê kết hợp sữa đặc, dùng với đá.',
  image: '/menu-images/ca-phe-sua-da.webp',
  basePrice: 29000,
  variants: [{ _id: 'v1', name: 'M', price: 29000, isAvailable: true }],
  isAvailable: true,
  isArchived: false,
  isFeatured: true,
  tags: ['đậm', 'tỉnh táo'],
  toppingIds: ['t1'],
  ingredientMetadata: { caffeine: true, dairy: true, flavorProfile: ['đắng'] },
  allowedOptions: {
    sizes: ['M'],
    sugarLevels: ['30%'],
    iceLevels: ['less-ice'],
    toppingIds: ['t1'],
  },
};

describe('admin product model', () => {
  it('round-trips a product through the form without touching fields the form does not edit', () => {
    const form = formFromProduct(product);
    expect(form.tagInput).toBe('đậm, tỉnh táo');
    expect(form.basePrice).toBe('29000');
    const payload = buildProductPayload(form, product);
    expect(payload).toMatchObject({
      name: product.name,
      basePrice: 29000,
      tags: ['đậm', 'tỉnh táo'],
      variants: [{ _id: 'v1', name: 'M', price: 29000, isAvailable: true }],
      allowedOptions: {
        sizes: ['M'],
        sugarLevels: ['30%'],
        iceLevels: ['less-ice'],
        toppingIds: ['t1'],
      },
      toppingIds: ['t1'],
      ingredientMetadata: product.ingredientMetadata,
    });
  });

  it('gives a new product default sugar/ice levels and empty metadata', () => {
    const payload = buildProductPayload(
      { ...EMPTY_FORM, name: 'Trà chanh', categoryId: '', tagInput: ' mát , chua nhẹ,, ' },
      null,
    );
    expect(payload.categoryId).toBeUndefined();
    expect(payload.tags).toEqual(['mát', 'chua nhẹ']);
    expect(payload.allowedOptions.sugarLevels).toEqual(['0%', '30%', '50%', '70%', '100%']);
    expect(payload.allowedOptions.iceLevels).toEqual(['no-ice', 'less-ice', 'normal-ice']);
    expect(payload.variants[0]).not.toHaveProperty('_id');
    expect(payload.ingredientMetadata).toEqual({
      caffeine: false,
      dairy: false,
      flavorProfile: [],
      allergens: [],
      notes: '',
    });
  });

  it('falls back to one M size when a stored product has no variants', () => {
    expect(formFromProduct({ ...product, variants: [] }).variants).toEqual([
      { name: 'M', price: 29000, isAvailable: true },
    ]);
  });

  it('merges suggested tags without duplicates and removes them from the suggestion list', () => {
    const merged = mergeSuggestedTags(
      { ...EMPTY_FORM, tagInput: 'đậm' },
      { mode: 'llm', tags: ['đậm', 'tỉnh táo', 'mát lạnh'] },
      ['đậm', 'tỉnh táo'],
    );
    expect(merged.form.tagInput).toBe('đậm, tỉnh táo');
    expect(merged.suggestions).toEqual({ mode: 'llm', tags: ['mát lạnh'] });
    expect(mergeSuggestedTags(EMPTY_FORM, null, ['x']).suggestions).toBeNull();
  });

  it('normalizes Vietnamese names for search', () => {
    expect(normalizeProductName('  Cà  Phê Sữa ĐÁ ')).toBe('ca phe sua da');
    expect(parseTags('')).toEqual([]);
  });
});
