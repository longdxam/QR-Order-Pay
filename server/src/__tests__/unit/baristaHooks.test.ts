import { describe, expect, it } from 'vitest';
import {
  afterBaristaResponse,
  afterMenuTagResponse,
  beforeBaristaRequest,
} from '../../ai/baristaHooks.js';
import { needsLanguageModel, ruleTags } from '../../services/aiService.js';
import { parseMenuSearchIntent, type SearchableProduct } from '../../services/menuSearchService.js';

const intent = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ message: 'Mình hiểu rồi', ...extra });

describe('Barista intent output boundary', () => {
  it.each([
    'not-json',
    JSON.stringify({ recommendations: [] }),
    JSON.stringify({ message: 'x', groupsInclude: 'coffee' }),
    JSON.stringify({ message: 'x', maxBudget: -5 }),
    JSON.stringify({ message: 'x', noCaffeine: 'yes' }),
  ])('rejects invalid structured output without echoing it', (raw) => {
    expect(() => afterBaristaResponse(raw)).toThrow('AI schema invalid');
  });

  it('fills safe defaults and drops unknown enum values', () => {
    const parsed = afterBaristaResponse(
      intent({ groupsInclude: ['tea', 'juice'], flavors: ['sour', 'umami'] }),
    );
    expect(parsed).toMatchObject({
      groupsInclude: ['tea'],
      groupsExclude: [],
      flavors: ['sour'],
      tags: [],
      keywords: [],
      noCaffeine: false,
      noDairy: false,
      lowSugar: false,
      maxBudget: null,
    });
  });

  it('never prefers a group the guest excluded and bounds list sizes', () => {
    const parsed = afterBaristaResponse(
      intent({
        groupsInclude: ['coffee', 'tea'],
        groupsExclude: ['coffee'],
        keywords: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'],
      }),
    );
    expect(parsed.groupsInclude).toEqual(['tea']);
    expect(parsed.keywords).toHaveLength(5);
  });

  it('accepts JSON wrapped in prose', () => {
    expect(afterBaristaResponse(`Đây: ${intent({ tags: ['mát lạnh'] })}`).tags).toEqual([
      'mát lạnh',
    ]);
  });

  it('sends only the sentence and tag vocabulary, never a menu', () => {
    const [system, user] = beforeBaristaRequest({
      prompt: 'buồn ngủ quá',
      budget: null,
      preferences: {},
      tagVocabulary: ['tỉnh táo'],
    });
    expect(system!.role).toBe('system');
    expect(Object.keys(JSON.parse(user!.content)).sort()).toEqual(
      ['budget', 'preferences', 'prompt', 'tagVocabulary'].sort(),
    );
  });
});

describe('Menu tag suggestion boundary', () => {
  it('keeps only vocabulary tags, normalised and de-duplicated', () => {
    expect(
      afterMenuTagResponse(
        JSON.stringify({ tags: ['Mát  Lạnh', 'mát lạnh', 'giảm cân', 42, 'thư giãn'] }),
      ),
    ).toEqual(['mát lạnh', 'thư giãn']);
  });
  it('rejects a non-object response', () => {
    expect(() => afterMenuTagResponse('tags: mát lạnh')).toThrow('AI schema invalid');
  });
  it('derives deterministic fallback tags from stored text', () => {
    expect(
      ruleTags({
        name: 'Trà đào cam sả',
        description: 'Vị chua thanh, uống lạnh',
        caffeine: false,
      }),
    ).toEqual(expect.arrayContaining(['chua nhẹ', 'thanh nhẹ', 'hương trái cây', 'mát lạnh']));
    expect(ruleTags({ name: 'Nước cam', caffeine: false })).not.toContain('tỉnh táo');
    expect(ruleTags({ name: 'Cà phê đen', description: 'đậm', caffeine: true })).toEqual(
      expect.arrayContaining(['tỉnh táo', 'đậm vị']),
    );
  });
});

describe('Language-model router', () => {
  const menu: SearchableProduct[] = [
    product('Trà đào cam sả', ['trà', 'trái cây']),
    product('Cà phê sữa đá', ['cà phê', 'tỉnh táo']),
  ];
  const needs = (prompt: string) =>
    needsLanguageModel(parseMenuSearchIntent(prompt).keywords, menu);

  it.each([
    'trà đào ít ngọt',
    'không caffeine dưới 40k',
    'cà phê không sữa',
    'gợi ý món gì ngon hôm nay',
    'tra dao',
    'món tỉnh táo',
  ])('answers "%s" with rules only', (prompt) => {
    expect(needs(prompt)).toBe(false);
  });

  it.each(['buồn ngủ quá', 'uống gì cho bạn gái', 'trời oi bức muốn giải nhiệt'])(
    'asks the model for free-form "%s"',
    (prompt) => {
      expect(needs(prompt)).toBe(true);
    },
  );
});

function product(name: string, tags: string[]): SearchableProduct {
  return {
    _id: name,
    name,
    description: '',
    image: '/x.webp',
    basePrice: 30_000,
    variants: [],
    allowedOptions: { sizes: [], sugarLevels: [] },
    tags,
    ingredientMetadata: { caffeine: false, dairy: false, flavorProfile: [] },
    isAvailable: true,
    isArchived: false,
  };
}
