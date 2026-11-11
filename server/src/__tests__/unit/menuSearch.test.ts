import { describe, expect, it } from 'vitest';
import { parseMenuSearchIntent, rankMenuProducts, type SearchableProduct } from '../../services/menuSearchService.js';

const products: SearchableProduct[] = [
  product('coffee-black', 'Cà phê đen đậm', 35_000, ['coffee', 'espresso'], true, false, ['đắng', 'đậm'], { featured: true }),
  product('latte', 'Cà phê sữa Latte', 45_000, ['coffee', 'latte'], true, true, ['béo', 'ngọt']),
  product('peach-tea', 'Trà đào trái cây', 39_000, ['tea', 'fruit', 'đào'], true, false, ['chua', 'thanh'], { featured: true }),
  product('herbal-tea', 'Trà thảo mộc trái cây', 40_000, ['tea', 'fruit'], false, false, ['chua', 'thanh']),
  product('lemon-soda', 'Soda chanh', 32_000, ['fruit', 'chanh'], false, false, ['chua', 'thanh']),
  product('cacao-milk', 'Cacao sữa', 38_000, ['cacao', 'chocolate'], false, true, ['béo', 'ngọt']),
  product('matcha-latte', 'Matcha latte', 48_000, ['tea', 'matcha'], true, true, ['béo']),
  product('strawberry-tea', 'Trà dâu trái cây', 29_000, ['tea', 'fruit', 'dâu'], false, false, ['chua'], { available: false }),
  product('oolong', 'Trà oolong', 36_000, ['tea', 'oolong'], true, false, ['thanh'], { variantAvailable: false }),
  {
    ...product('unknown', 'Nước bí ẩn', 20_000, ['mystery'], false, false, []),
    ingredientMetadata: { flavorProfile: [] },
  },
];

function search(query: string) {
  return rankMenuProducts(products, parseMenuSearchIntent(query));
}

describe('Vietnamese menu search evaluation set', () => {
  const topOneCases: Array<[string, string]> = [
    ['cà phê', 'coffee-black'],
    ['ca phe', 'coffee-black'],
    ['caphe', 'coffee-black'],
    ['caphee', 'coffee-black'],
    ['cà phê đậm', 'coffee-black'],
    ['trà đào', 'peach-tea'],
    ['tra dao', 'peach-tea'],
    ['traa daoo', 'peach-tea'],
    ['trà trái cây ít ngọt', 'peach-tea'],
    ['cà phê không sữa', 'coffee-black'],
    ['không cà phê, trà đào', 'peach-tea'],
    ['trà trái cây dưới 40 nghìn', 'peach-tea'],
    ['món không caffeine không sữa dưới 35k', 'lemon-soda'],
  ];

  it.each(topOneCases)('ranks a predefined top result for "%s"', (query, expectedId) => {
    expect(search(query)[0]?.productId).toBe(expectedId);
  });

  it('treats "không cà phê" as category exclusion, not caffeine exclusion', () => {
    const intent = parseMenuSearchIntent('không cà phê');
    expect(intent.requirements.excludedGroups).toEqual(['coffee']);
    expect(intent.requirements.noCaffeine).toBe(false);
    expect(search('không cà phê').every((item) => !item.productId.startsWith('coffee') && item.productId !== 'latte')).toBe(true);
  });

  it.each(['không caffeine', 'mon khong cafein', 'decaf'])('never returns known caffeinated products for "%s"', (query) => {
    const ids = search(query).map((item) => item.productId);
    expect(ids).not.toContain('coffee-black');
    expect(ids).not.toContain('latte');
    expect(ids).not.toContain('peach-tea');
    expect(ids).not.toContain('matcha-latte');
    expect(ids).not.toContain('unknown');
  });

  it('requires trusted metadata for no-dairy results', () => {
    const ids = search('không sữa').map((item) => item.productId);
    expect(ids).not.toContain('latte');
    expect(ids).not.toContain('cacao-milk');
    expect(ids).not.toContain('unknown');
  });

  it.each(['sữa', 'sua', 'có sữa', 'tìm sữa'])('preserves the milk keyword in "%s" instead of returning general suggestions', (query) => {
    expect(parseMenuSearchIntent(query).keywords).toContain('sua');
    const ids = search(query).map((item) => item.productId);
    expect(ids.sort()).toEqual(['cacao-milk', 'latte']);
  });

  it('combines milk with coffee or tea rather than matching the whole group', () => {
    expect(search('cà phê sữa').map((item) => item.productId)).toEqual(['latte']);
    const milkTea = product('milk-tea', 'Hồng trà sữa', 42000, ['tea'], true, true, ['ngọt']);
    expect(rankMenuProducts([...products, milkTea], parseMenuSearchIntent('trà sữa')).map((item) => item.productId)).toEqual(['milk-tea']);
  });

  it('does not match milk solely because a product explicitly says without milk', () => {
    const plain = product('plain', 'Cà phê không sữa', 20000, [], true, false, []);
    const juice = product('juice', 'Nước ép', 20000, [], false, false, []);
    juice.description = 'Không có sữa';
    const plantMilk = product('oat', 'Sữa yến mạch', 30000, [], false, false, []);
    expect(rankMenuProducts([plain, juice, plantMilk], parseMenuSearchIntent('sữa')).map((item) => item.productId)).toEqual(['oat']);
  });

  it.each(['không sữa', 'không có sữa', 'cà phê không sữa'])('keeps "%s" as an exclusion without a positive milk keyword', (query) => {
    const intent = parseMenuSearchIntent(query);
    expect(intent.keywords).not.toContain('sua');
    expect(intent.requirements.noDairy).toBe(true);
    const ids = rankMenuProducts(products, intent).map((item) => item.productId);
    expect(ids).toContain('coffee-black');
    expect(ids).not.toContain('latte');
    expect(ids).not.toContain('cacao-milk');
    expect(ids).not.toContain('unknown');
  });

  it('distinguishes strict "dưới" from inclusive "không quá" at the price boundary', () => {
    const strictIds = search('dưới 40 nghìn').map((item) => item.productId);
    const inclusiveIds = search('không quá 40 nghìn').map((item) => item.productId);
    expect(strictIds).not.toContain('herbal-tea');
    expect(inclusiveIds).toContain('herbal-tea');
  });

  it.each([
    ['tối đa 40k', 40_000, true],
    ['ngân sách 40.000đ', 40_000, true],
    ['duoi 39,5k', 39_500, false],
  ] as const)('normalizes budget in "%s"', (query, amount, inclusive) => {
    expect(parseMenuSearchIntent(query).requirements.budget).toEqual({ maxVnd: amount, inclusive, scope: 'item' });
  });

  it('excludes unavailable products and products with no available size', () => {
    expect(search('trà dâu')).toEqual([]);
    expect(search('oolong')).toEqual([]);
  });

  it('returns an honest empty result for an unknown query', () => {
    expect(search('xyzabc')).toEqual([]);
  });

  it('allows explicit editable filters to override parsed boolean and budget conditions', () => {
    const intent = parseMenuSearchIntent('không caffeine dưới 40k', {
      noCaffeine: false,
      maxBudget: null,
    });
    expect(intent.requirements.noCaffeine).toBe(false);
    expect(intent.requirements.budget).toBeNull();
  });

  it('does not fuzz ambiguous three-letter words into menu terms', () => {
    const intent = parseMenuSearchIntent('ngon quá, thích lắm');
    expect(intent.keywords).not.toContain('sua');
    expect(intent.preferences.flavors).not.toContain('bitter');
    expect(parseMenuSearchIntent('traa daoo').normalizedQuery).toBe('tra dao');
  });

  it('can rank with soft keywords and any-of groups for recommendations', () => {
    const intent = parseMenuSearchIntent('trà đào');
    const strict = rankMenuProducts(products, intent).map((item) => item.productId);
    const soft = rankMenuProducts(products, { ...intent, keywords: ['xyz'] }, {
      keywordsRequired: false,
    }).map((item) => item.productId);
    expect(strict[0]).toBe('peach-tea');
    expect(soft.length).toBeGreaterThan(0);
    const anyGroup = rankMenuProducts(
      products,
      { ...intent, keywords: [], requirements: { ...intent.requirements, includedGroups: ['tea', 'fruit'] } },
      { keywordsRequired: false, includedGroupsMode: 'any' },
    ).map((item) => item.productId);
    expect(anyGroup).toContain('lemon-soda');
    expect(anyGroup).toContain('matcha-latte');
  });
});

function product(
  id: string,
  name: string,
  price: number,
  tags: string[],
  caffeine: boolean,
  dairy: boolean,
  flavorProfile: string[],
  options: { featured?: boolean; available?: boolean; variantAvailable?: boolean } = {},
): SearchableProduct {
  return {
    _id: id,
    name,
    description: `${name} thơm ngon`,
    image: `https://example.com/${id}.jpg`,
    basePrice: price,
    variants: [{ _id: `${id}-s`, name: 'S', price, isAvailable: options.variantAvailable ?? true }],
    allowedOptions: { sizes: ['S'], sugarLevels: ['0%', '25%', '50%', '100%'] },
    tags,
    ingredientMetadata: { caffeine, dairy, flavorProfile },
    isAvailable: options.available ?? true,
    isArchived: false,
    isFeatured: options.featured ?? false,
  };
}
