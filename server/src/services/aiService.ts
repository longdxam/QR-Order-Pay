import type { MenuSearchIntent } from '@may-cafe/contracts';
import { config } from '../config/index.js';
import { HttpAIProvider, type AIProvider } from '../providers/aiProvider.js';
import { productRepository } from '../repositories/productRepository.js';
import { categoryRepository } from '../repositories/categoryRepository.js';
import { logger } from '../infrastructure/logger.js';
import type { ProductDoc } from '../models/Product.js';
import {
  afterBaristaResponse,
  afterMenuTagResponse,
  beforeBaristaRequest,
  beforeMenuTagRequest,
  type BaristaIntent,
} from '../ai/baristaHooks.js';
import {
  INTENT_TAG_LIMIT,
  MENU_TAG_VOCABULARY,
  TAG_HINTS,
  isVocabularyTag,
  normalizeTag,
} from '../ai/menuTagVocabulary.js';
import {
  foldText,
  isMenuTerm,
  menuVocabulary,
  parseMenuSearchIntent,
  rankMenuProducts,
  type SearchableProduct,
} from './menuSearchService.js';

export interface RecommendInput {
  prompt: string;
  preferences?: {
    noCaffeine?: boolean;
    noDairy?: boolean;
    lowSugar?: boolean;
    flavor?: string;
  };
  maxBudget?: number;
}

/**
 * rules: backend understood the request without a model call.
 * llm: the model extracted the intent and backend ranked the real menu.
 * llm_fallback: a model call was needed but failed, so rules answered instead.
 */
export type RecommendRoute = 'rules' | 'llm' | 'llm_fallback';

export interface RecommendResult {
  mode: 'llm' | 'fallback';
  route: RecommendRoute;
  message: string;
  recommendations: Array<{
    productId: string;
    variantId: string | null;
    reason: string;
    unitPrice: number;
    name: string;
    image: string;
    evidence: {
      variant: string | null;
      price: number;
      withinBudget: boolean;
      caffeine: boolean | null;
      dairy: boolean | null;
    };
  }>;
  followUpQuestion?: string;
  latencyMs: number;
}

export interface TagSuggestionInput {
  name: string;
  description?: string;
  categoryId?: string;
  tags?: string[];
  flavorProfile?: string[];
  caffeine?: boolean | null;
  dairy?: boolean | null;
}

export interface TagSuggestionResult {
  mode: 'llm' | 'fallback';
  tags: string[];
}

type Group = MenuSearchIntent['requirements']['includedGroups'][number];
type Flavor = MenuSearchIntent['preferences']['flavors'][number];

// Words that carry no menu meaning; a prompt made only of these does not need a model.
// prettier-ignore
const GENERIC_WORDS = new Set([
  'gi', 'nao', 'ngon', 'hom', 'nay', 'nhe', 'di', 'oi', 'voi', 'la', 'nhat', 'hay', 'ban', 'quan',
  'thu', 'duoc', 'nuoc', 'ly', 'coc', 'them', 'chut', 'hot', 'best', 'seller', 'de', 'xuat',
  'recommend', 'nhung', 'va', 'hoac', 'hon', 'rat', 'lam', 'size', 'nhu', 'the', 'ai', 'em', 'anh',
  'chi', 'ah', 'a', 'nha', 'gio', 'luc', 'kieu', 'loai', 'khac', 'moi',
]);

export class AIService {
  constructor(
    private readonly provider: AIProvider | null,
    private readonly mode: 'live' | 'fallback' | 'off',
  ) {}

  async recommend(rawInput: RecommendInput): Promise<RecommendResult> {
    const started = Date.now();
    const input = normalizePreferences(rawInput);
    const products = await productRepository.listPublic({});
    const parsed = parseMenuSearchIntent(input.prompt);
    const rules = (message: string, route: RecommendRoute) =>
      recommendFromIntent(products, input, rulesIntent(input, parsed), {
        mode: 'fallback',
        route,
        message,
        started,
      });

    if (this.mode === 'off')
      return rules('Chế độ AI đang tắt. Đang hiển thị gợi ý theo menu.', 'rules');
    if (!this.provider) return rules('AI Barista đang dùng gợi ý theo menu.', 'rules');
    if (!needsLanguageModel(parsed.keywords, products))
      return rules('Đã hiểu yêu cầu của bạn, đây là các món phù hợp trong menu.', 'rules');

    let intent: BaristaIntent;
    try {
      const raw = await this.provider.chat(
        beforeBaristaRequest({
          prompt: input.prompt,
          budget: input.maxBudget ?? null,
          preferences: input.preferences ?? {},
          tagVocabulary: intentTagVocabulary(products),
        }),
        { model: config.ai.model, jsonMode: true, temperature: 0.2 },
      );
      intent = afterBaristaResponse(raw);
    } catch (error) {
      logger.warn({ err: (error as Error).message }, 'ai intent failed; using rules');
      return rules('AI tạm thời không khả dụng, đang dùng gợi ý theo menu.', 'llm_fallback');
    }
    const merged = mergeModelIntent(input, parsed, intent);
    return recommendFromIntent(products, merged.input, merged.intent, {
      mode: 'llm',
      route: 'llm',
      message: intent.message,
      followUpQuestion: intent.followUpQuestion,
      requestedTags: intent.tags,
      started,
    });
  }

  /** Suggestions only: nothing is saved until Admin reviews them and saves the product. */
  async suggestTags(input: TagSuggestionInput): Promise<TagSuggestionResult> {
    const current = new Set((input.tags ?? []).map(normalizeTag));
    const fresh = (tags: string[]) => tags.filter((tag) => !current.has(tag)).slice(0, 5);
    if (this.mode !== 'live' || !this.provider)
      return { mode: 'fallback', tags: fresh(ruleTags(input)) };
    try {
      const category = input.categoryId
        ? ((await categoryRepository.findById(input.categoryId))?.name ?? null)
        : null;
      const raw = await this.provider.chat(
        beforeMenuTagRequest({
          name: input.name,
          description: input.description ?? '',
          category,
          flavorProfile: input.flavorProfile ?? [],
          caffeine: input.caffeine ?? null,
          dairy: input.dairy ?? null,
          currentTags: [...current],
          tagVocabulary: [...MENU_TAG_VOCABULARY],
        }),
        { model: config.ai.model, jsonMode: true, temperature: 0.2 },
      );
      // "tỉnh táo" implies caffeine; never trust the model over stored metadata.
      const tags = afterMenuTagResponse(raw).filter(
        (tag) => tag !== 'tỉnh táo' || input.caffeine === true,
      );
      return { mode: 'llm', tags: fresh(tags) };
    } catch (error) {
      logger.warn({ err: (error as Error).message }, 'ai tag suggestion failed; using rules');
      return { mode: 'fallback', tags: fresh(ruleTags(input)) };
    }
  }
}

/** B — the model is only needed when the prompt has words the rules and the menu cannot explain. */
export function needsLanguageModel(
  keywords: string[],
  products: readonly SearchableProduct[],
): boolean {
  const vocabulary = menuVocabulary(products);
  return keywords.some(
    (keyword) => !GENERIC_WORDS.has(keyword) && !isMenuTerm(keyword, vocabulary),
  );
}

function intentTagVocabulary(products: readonly ProductDoc[]): string[] {
  const tags = new Set<string>(MENU_TAG_VOCABULARY);
  for (const product of products) {
    for (const tag of product.tags ?? []) {
      if (tags.size >= INTENT_TAG_LIMIT) break;
      const normalized = normalizeTag(tag);
      if (normalized.length > 0 && normalized.length <= 30) tags.add(normalized);
    }
  }
  return [...tags].slice(0, INTENT_TAG_LIMIT);
}

function rulesIntent(input: RecommendInput, parsed: MenuSearchIntent): MenuSearchIntent {
  const pref = input.preferences ?? {};
  const flavorHint = pref.flavor ? parseMenuSearchIntent(pref.flavor) : null;
  return {
    normalizedQuery: parsed.normalizedQuery,
    keywords: unique([...parsed.keywords, ...(flavorHint?.keywords ?? [])]),
    requirements: {
      noCaffeine: Boolean(pref.noCaffeine),
      noDairy: Boolean(pref.noDairy),
      includedGroups: parsed.requirements.includedGroups,
      excludedGroups: parsed.requirements.excludedGroups,
      budget: input.maxBudget ? { maxVnd: input.maxBudget, inclusive: true, scope: 'item' } : null,
    },
    preferences: {
      lowSugar: Boolean(pref.lowSugar) || parsed.preferences.lowSugar,
      flavors: unique([...parsed.preferences.flavors, ...(flavorHint?.preferences.flavors ?? [])]),
    },
  };
}

/** The model may only add constraints or hints; it can never loosen what the guest or UI set. */
function mergeModelIntent(
  input: RecommendInput,
  parsed: MenuSearchIntent,
  model: BaristaIntent,
): { input: RecommendInput; intent: MenuSearchIntent } {
  const pref = input.preferences ?? {};
  const merged: RecommendInput = {
    ...input,
    maxBudget: input.maxBudget ?? model.maxBudget ?? undefined,
    preferences: {
      ...pref,
      noCaffeine: Boolean(pref.noCaffeine) || model.noCaffeine,
      noDairy: Boolean(pref.noDairy) || model.noDairy,
      lowSugar: Boolean(pref.lowSugar) || model.lowSugar,
    },
  };
  const base = rulesIntent(merged, parsed);
  const excluded = unique<Group>([...base.requirements.excludedGroups, ...model.groupsExclude]);
  const modelTerms = [...model.keywords, ...model.tags]
    .map(foldText)
    .filter((term) => term.length >= 2 && term.length <= 40);
  const hints = model.tags.map((tag) => TAG_HINTS[normalizeTag(tag) as keyof typeof TAG_HINTS]);
  // A caffeine-seeking tag must not pull coffee/tea in when the guest asked for no caffeine.
  const hintGroups = merged.preferences?.noCaffeine
    ? []
    : hints.flatMap((hint) => hint?.groups ?? []);
  const hintFlavors = hints.flatMap((hint) => hint?.flavors ?? []);
  return {
    input: merged,
    intent: {
      ...base,
      keywords: unique([...base.keywords, ...modelTerms]),
      requirements: {
        ...base.requirements,
        excludedGroups: excluded,
        includedGroups: unique<Group>([
          ...base.requirements.includedGroups,
          ...model.groupsInclude,
          ...hintGroups,
        ]).filter((group) => !excluded.includes(group)),
      },
      preferences: {
        ...base.preferences,
        flavors: unique<Flavor>([...base.preferences.flavors, ...model.flavors, ...hintFlavors]),
      },
    },
  };
}

function recommendFromIntent(
  products: readonly ProductDoc[],
  input: RecommendInput,
  intent: MenuSearchIntent,
  meta: {
    mode: RecommendResult['mode'];
    route: RecommendRoute;
    message: string;
    followUpQuestion?: string;
    requestedTags?: string[];
    started: number;
  },
): RecommendResult {
  const eligible = products.filter((p) => matchesPreferences(p, input));
  const options = { keywordsRequired: false, includedGroupsMode: 'any' as const };
  let ranked = rankMenuProducts(eligible, intent, options);
  // Preferred groups are soft: if nothing in them qualifies, fall back to the whole eligible menu.
  if (ranked.length === 0 && intent.requirements.includedGroups.length > 0)
    ranked = rankMenuProducts(
      eligible,
      { ...intent, requirements: { ...intent.requirements, includedGroups: [] } },
      options,
    );
  const byId = new Map(eligible.map((p) => [p._id.toString(), p]));
  const budget = input.maxBudget ?? null;
  const pref = input.preferences ?? {};
  const requestedTags = new Set((meta.requestedTags ?? []).map(normalizeTag));
  const recommendations = ranked.slice(0, 3).flatMap((item) => {
    const product = byId.get(item.productId);
    if (!product) return [];
    const variant = item.variantId
      ? (product.variants.find((v) => v._id?.toString() === item.variantId) ?? null)
      : null;
    const matchedTags = (product.tags ?? [])
      .map(normalizeTag)
      .filter((tag) => requestedTags.has(tag));
    return [
      {
        productId: item.productId,
        variantId: item.variantId,
        reason: verifiedReason(variant?.name ?? null, item.unitPrice, pref, budget, matchedTags),
        unitPrice: item.unitPrice,
        name: product.name,
        image: product.image,
        evidence: recommendationEvidence(product, variant?.name ?? null, item.unitPrice, budget),
      },
    ];
  });
  return {
    mode: meta.mode,
    route: meta.route,
    message:
      recommendations.length > 0
        ? meta.message
        : 'Hiện chưa có món phù hợp tất cả lựa chọn. Bạn có thể đổi ngân sách hoặc khẩu vị rồi thử lại.',
    recommendations,
    ...(meta.followUpQuestion ? { followUpQuestion: meta.followUpQuestion } : {}),
    latencyMs: Date.now() - meta.started,
  };
}

function availableVariant(p: ProductDoc) {
  return (
    p.variants
      .filter((v) => v.isAvailable !== false && p.allowedOptions.sizes.includes(v.name))
      .sort((a, b) => a.price - b.price)[0] ?? null
  );
}

function matchesPreferences(p: ProductDoc, input: RecommendInput): boolean {
  if (!p.isAvailable || p.isArchived) return false;
  // Hydration defaults are not evidence of ingredient metadata stored in the database.
  if (
    input.preferences?.noCaffeine &&
    (p.$isDefault('ingredientMetadata') ||
      p.$isDefault('ingredientMetadata.caffeine') ||
      p.ingredientMetadata?.caffeine !== false)
  )
    return false;
  if (
    input.preferences?.noDairy &&
    (p.$isDefault('ingredientMetadata') ||
      p.$isDefault('ingredientMetadata.dairy') ||
      p.ingredientMetadata?.dairy !== false)
  )
    return false;
  const variant = availableVariant(p);
  if (p.variants.length > 0 && !variant) return false;
  return (variant?.price ?? p.basePrice) <= (input.maxBudget ?? Infinity);
}

export function normalizePreferences(input: RecommendInput): RecommendInput {
  const prompt = input.prompt.toLowerCase();
  const budget = /(?:dưới|tối đa|ngân sách)\s*(\d+(?:[.,]\d+)?)\s*(k|nghìn|ngàn|đ|vnd)?/.exec(
    prompt,
  );
  return {
    ...input,
    maxBudget:
      input.maxBudget ??
      (budget
        ? Number(budget[1]!.replace(',', '.')) *
          (/^(k|nghìn|ngàn)$/.test(budget[2] ?? '') ? 1000 : 1)
        : undefined),
    preferences: {
      ...input.preferences,
      // "không cà phê" loại nhóm coffee, không đồng nghĩa "không caffeine" (trà/matcha vẫn có thể chứa caffeine).
      noCaffeine:
        input.preferences?.noCaffeine ||
        /(?:không (?:có |uống )?(?:caffeine|cafein)|decaf)/.test(prompt),
      noDairy: input.preferences?.noDairy || /không (?:có |uống )?sữa/.test(prompt),
      lowSugar: input.preferences?.lowSugar || /ít (?:ngọt|đường)/.test(prompt),
    },
  };
}

function verifiedReason(
  variant: string | null,
  price: number,
  pref: NonNullable<RecommendInput['preferences']>,
  budget: number | null,
  matchedTags: string[],
): string {
  const reasons: string[] = [];
  if (variant) reasons.push(`size ${variant}`);
  reasons.push(`${price.toLocaleString('vi-VN')}đ`);
  if (budget !== null) reasons.push(`không vượt ngân sách ${budget.toLocaleString('vi-VN')}đ`);
  if (pref.noCaffeine) reasons.push('metadata xác nhận không caffeine');
  if (pref.noDairy) reasons.push('metadata xác nhận không sữa');
  if (pref.lowSugar) reasons.push('có thể chọn mức đường thấp');
  if (pref.flavor) reasons.push(`hương ${pref.flavor}`);
  if (matchedTags.length > 0) reasons.push(`hợp: ${matchedTags.slice(0, 2).join(', ')}`);
  return reasons.join(' · ');
}

function recommendationEvidence(
  p: ProductDoc,
  variant: string | null,
  price: number,
  budget: number | null,
) {
  return {
    variant,
    price,
    withinBudget: budget === null || price <= budget,
    caffeine: p.ingredientMetadata?.caffeine ?? null,
    dairy: p.ingredientMetadata?.dairy ?? null,
  };
}

/** C fallback — deterministic suggestions from stored text, used when AI is not live or fails. */
export function ruleTags(input: TagSuggestionInput): string[] {
  const text = foldText(
    [
      input.name,
      input.description ?? '',
      ...(input.flavorProfile ?? []),
      ...(input.tags ?? []),
    ].join(' '),
  );
  const tags: string[] = [];
  const add = (tag: (typeof MENU_TAG_VOCABULARY)[number], when: boolean) => {
    if (when && !tags.includes(tag)) tags.push(tag);
  };
  add('tỉnh táo', input.caffeine === true);
  add('chua nhẹ', /\bchua\b/.test(text));
  add('đậm vị', /\b(?:dang|dam|espresso|robusta)\b/.test(text));
  add('béo ngậy', /\b(?:beo|kem|cream|cot\s+dua|latte)\b/.test(text));
  add('thanh nhẹ', /\b(?:thanh|nhe)\b/.test(text));
  add('ngọt dịu', /\bngot\b/.test(text));
  add(
    'hương trái cây',
    /\b(?:trai\s+cay|dao|chanh|dau|cam|vai|xoai|buoi|oi|thom|chanh\s+day)\b/.test(text),
  );
  add('hương hoa', /\b(?:hoa|nhai|lai|sen|cuc|hibiscus)\b/.test(text));
  add('mát lạnh', /\b(?:da\s+xay|soda|smoothie|lanh|mat)\b/.test(text));
  add('ấm nóng', /\b(?:nong|am)\b/.test(text));
  add('tráng miệng', /\b(?:cacao|chocolate|socola|banh|kem)\b/.test(text));
  return tags.filter(isVocabularyTag);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function buildAIService(): AIService {
  if (config.ai.mode === 'live') {
    const provider = new HttpAIProvider({
      name: config.ai.provider,
      apiKey: config.ai.apiKey,
      baseUrl: config.ai.baseUrl,
    });
    return new AIService(provider, 'live');
  }
  return new AIService(null, config.ai.mode);
}

export async function validateRecommendedConfiguration(input: {
  productId: string;
  variantId: string | null;
  toppingIds: string[];
  constraints: { noCaffeine?: boolean; noDairy?: boolean; maxBudget?: number };
}) {
  const [product, toppings] = await Promise.all([
    productRepository.findById(input.productId),
    input.toppingIds.length > 0
      ? (await import('../repositories/toppingRepository.js')).toppingRepository.findManyByIds(
          input.toppingIds,
        )
      : Promise.resolve([]),
  ]);
  const violations: string[] = [];
  try {
    const { assertInventoryAvailable } = await import('./inventoryAvailabilityService.js');
    await assertInventoryAvailable([
      {
        productId: input.productId,
        variantId: input.variantId,
        toppingIds: input.toppingIds,
        quantity: 1,
      },
    ]);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'INSUFFICIENT_STOCK')
      violations.push('Không đủ nguyên liệu cho cấu hình đã chọn.');
    else throw error;
  }
  if (
    !product ||
    product.isArchived ||
    !product.isAvailable ||
    !(await categoryRepository.findById(String(product.categoryId)))?.isActive
  )
    return { valid: false, total: 0, violations: ['Món không còn khả dụng.'] };
  const variant = input.variantId
    ? product.variants.find(
        (item) => item._id?.toString() === input.variantId && item.isAvailable !== false,
      )
    : null;
  if (product.variants.length > 0 && !variant) violations.push('Size không còn khả dụng.');
  let total = variant?.price ?? product.basePrice;
  for (const toppingId of input.toppingIds) {
    const topping = toppings.find((item) => item.id === toppingId);
    if (
      !topping ||
      topping.isArchived ||
      !topping.isAvailable ||
      !product.allowedOptions.toppingIds.map(String).includes(toppingId)
    )
      violations.push(`Topping ${toppingId} không khả dụng.`);
    else {
      total += topping.price;
      if (input.constraints.noDairy && topping.ingredientMetadata?.dairy !== false)
        violations.push(`Không thể xác nhận topping ${topping.name} là không sữa.`);
    }
  }
  if (input.constraints.noCaffeine && product.ingredientMetadata?.caffeine !== false)
    violations.push('Cấu hình không đáp ứng yêu cầu không caffeine.');
  if (input.constraints.noDairy && product.ingredientMetadata?.dairy !== false)
    violations.push('Món nền không đáp ứng yêu cầu không sữa.');
  if (input.constraints.maxBudget !== undefined && total > input.constraints.maxBudget)
    violations.push(`Tổng cấu hình ${total.toLocaleString('vi-VN')}đ vượt ngân sách.`);
  return { valid: violations.length === 0, total, violations };
}
