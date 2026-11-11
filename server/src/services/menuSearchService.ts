import type { MenuSearchIntent, MenuSearchRequest, MenuSearchResponse } from '@may-cafe/contracts';
import { productRepository } from '../repositories/productRepository.js';

type Group = MenuSearchIntent['requirements']['includedGroups'][number];
type Flavor = MenuSearchIntent['preferences']['flavors'][number];

interface SearchableProduct {
  _id: { toString(): string } | string;
  name: string;
  description: string;
  image: string;
  basePrice: number;
  variants: Array<{ _id?: { toString(): string } | string | null; name: string; price: number; isAvailable?: boolean | null }>;
  allowedOptions: { sizes: string[]; sugarLevels: string[] };
  tags?: string[] | null;
  ingredientMetadata?: {
    caffeine?: boolean | null;
    dairy?: boolean | null;
    flavorProfile?: string[] | null;
  } | null;
  isAvailable: boolean;
  isArchived: boolean;
  isFeatured?: boolean | null;
}

const KNOWN_TOKENS = ['caphe', 'coffee', 'cafe', 'tra', 'dao', 'dau', 'sua', 'caffeine', 'cafein', 'chua', 'dang', 'dam', 'ngot', 'matcha', 'chocolate', 'cacao', 'chanh'];
const STOP_WORDS = new Set([
  'toi', 'minh', 'muon', 'can', 'tim', 'goi', 'y', 'giup', 'cho', 'mot', 'mon', 'do', 'uong', 'co', 'vi', 'duoi', 'toi',
  'da', 'khong', 'it', 'nhieu', 'nghin', 'ngan', 'vnd', 'dong', 'k', 'ngan', 'sach', 'qua', 'gia', 'tam', 'khoang',
  'caffeine', 'cafein', 'ngot', 'duong', 'chua', 'dang', 'dam', 'thanh', 'beo', 'cafe', 'coffee', 'caphe', 'tra',
  'trai', 'cay', 'ca', 'phe',
]);

export async function searchMenu(input: MenuSearchRequest): Promise<MenuSearchResponse> {
  const started = Date.now();
  const intent = parseMenuSearchIntent(input.query, input.filters);
  const products = await productRepository.listPublic({});
  const items = rankMenuProducts(products, intent).slice(0, 12);
  return {
    mode: 'fallback',
    intent,
    message: items.length > 0
      ? `Tìm thấy ${items.length} món phù hợp. Giá áp dụng cho một món với cấu hình khả dụng rẻ nhất.`
      : 'Không có món khớp tất cả điều kiện bắt buộc. Hãy sửa từ khóa, ngân sách hoặc bỏ bớt bộ lọc.',
    items,
    latencyMs: Date.now() - started,
  };
}

export function parseMenuSearchIntent(query: string, filters: MenuSearchRequest['filters'] = {}): MenuSearchIntent {
  const folded = fold(query);
  const normalizedQuery = canonicalizeTypos(folded);
  const excludedGroups = new Set<Group>();
  const includedGroups = new Set<Group>();

  if (/\bkhong\s+(?:uong\s+)?(?:ca\s+phe|cafe|coffee|caphe)\b/.test(normalizedQuery)) excludedGroups.add('coffee');
  else if (/\b(?:ca\s+phe|cafe|coffee|caphe|espresso|cold\s*brew)\b/.test(normalizedQuery)) includedGroups.add('coffee');
  if (/\b(?:tra|tea|matcha)\b/.test(normalizedQuery)) includedGroups.add('tea');
  if (/\b(?:trai\s+cay|fruit|chanh|dao|cam|vai|dau|xoai|chanh\s+day)\b/.test(normalizedQuery)) includedGroups.add('fruit');

  const parsedBudget = parseBudget(normalizedQuery);
  const budget = filters?.maxBudget === null
    ? null
    : filters?.maxBudget !== undefined
      ? { maxVnd: filters.maxBudget, inclusive: true, scope: 'item' as const }
      : parsedBudget;
  const parsedNoCaffeine = /\b(?:khong\s+(?:co\s+)?(?:caffeine|cafein)|decaf)\b/.test(normalizedQuery);
  const parsedNoDairy = /\bkhong\s+(?:co\s+)?sua\b/.test(normalizedQuery);
  const noCaffeine = filters?.noCaffeine ?? parsedNoCaffeine;
  const noDairy = filters?.noDairy ?? parsedNoDairy;
  const lowSugar = /\b(?:it\s+(?:ngot|duong)|giam\s+duong)\b/.test(normalizedQuery);

  const flavors = new Set<Flavor>();
  if (/\b(?:chua|thanh\s+chua)\b/.test(normalizedQuery)) flavors.add('sour');
  if (/\b(?:dang|dam)\b/.test(normalizedQuery)) flavors.add('bitter');
  if (/\bngot\b/.test(normalizedQuery) && !lowSugar) flavors.add('sweet');
  if (/\bthanh\b/.test(normalizedQuery)) flavors.add('light');
  if (/\b(?:beo|ngay)\b/.test(normalizedQuery)) flavors.add('rich');

  const keywords = stripNoMilk(normalizedQuery)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token) && !/^\d/.test(token))
    .filter((token, index, all) => all.indexOf(token) === index);

  return {
    normalizedQuery,
    keywords,
    requirements: {
      noCaffeine,
      noDairy,
      includedGroups: [...includedGroups],
      excludedGroups: [...excludedGroups],
      budget,
    },
    preferences: { lowSugar, flavors: [...flavors] },
  };
}

export interface RankOptions {
  /** Search requires at least one keyword hit; recommendations treat keywords as soft hints. */
  keywordsRequired?: boolean;
  /** Search requires every included group; recommendations accept any of them. */
  includedGroupsMode?: 'all' | 'any';
}

export function rankMenuProducts(
  products: readonly SearchableProduct[],
  intent: MenuSearchIntent,
  options: RankOptions = {},
): MenuSearchResponse['items'] {
  const keywordsRequired = options.keywordsRequired ?? true;
  const groupsMode = options.includedGroupsMode ?? 'all';
  const ranked: Array<MenuSearchResponse['items'][number] & { score: number }> = [];
  for (const product of products) {
    if (!product.isAvailable || product.isArchived) continue;
    const variant = cheapestAvailableVariant(product);
    if (product.variants.length > 0 && !variant) continue;
    const price = variant?.price ?? product.basePrice;
    const budget = intent.requirements.budget;
    if (budget && (budget.inclusive ? price > budget.maxVnd : price >= budget.maxVnd)) continue;
    if (intent.requirements.noCaffeine && product.ingredientMetadata?.caffeine !== false) continue;
    if (intent.requirements.noDairy && product.ingredientMetadata?.dairy !== false) continue;

    const text = productText(product);
    const groups = classifyGroups(text);
    const included = intent.requirements.includedGroups;
    if (groupsMode === 'all' && included.some((group) => !groups.has(group))) continue;
    if (groupsMode === 'any' && included.length > 0 && !included.some((group) => groups.has(group))) continue;
    if (intent.requirements.excludedGroups.some((group) => groups.has(group))) continue;

    const textTokens = text.split(/\s+/);
    let keywordScore = 0;
    let matchedKeywords = 0;
    for (const keyword of intent.keywords) {
      const score = tokenMatchScore(keyword, text, textTokens);
      keywordScore += score;
      if (score > 0) matchedKeywords += 1;
    }
    if (keywordsRequired && intent.keywords.length > 0 && matchedKeywords === 0) continue;

    const flavors = (product.ingredientMetadata?.flavorProfile ?? []).map(fold);
    let score = keywordScore;
    score += included.filter((group) => groups.has(group)).length * 4;
    score += intent.preferences.flavors.filter((flavor) => flavorMatches(flavor, flavors)).length * 3;
    if (intent.preferences.lowSugar && product.allowedOptions.sugarLevels.some((level) => /^(0|25)%$/.test(level))) score += 2;
    if (product.isFeatured) score += 1;
    score += Math.max(0, 1 - price / 1_000_000);

    ranked.push({
      productId: idOf(product._id),
      variantId: variant?._id ? idOf(variant._id) : null,
      name: product.name,
      description: product.description,
      image: product.image,
      unitPrice: price,
      reason: buildReason(product, intent, price),
      score,
    });
  }
  return ranked.sort((a, b) => b.score - a.score || a.unitPrice - b.unitPrice || a.name.localeCompare(b.name, 'vi'))
    .map(({ score: _score, ...item }) => item);
}

function parseBudget(query: string): MenuSearchIntent['requirements']['budget'] {
  const match = /\b(duoi|khong\s+qua|toi\s+da|ngan\s+sach)\s*(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(k|nghin|ngan|vnd|d|dong)?\b/.exec(query);
  if (!match) return null;
  const raw = match[2]!;
  const unit = match[3] ?? '';
  let amount: number;
  if (/^(k|nghin|ngan)$/.test(unit)) amount = Number(raw.replace(',', '.')) * 1_000;
  else amount = Number(raw.replace(/[.,](?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { maxVnd: Math.round(amount), inclusive: match[1] !== 'duoi', scope: 'item' };
}

function cheapestAvailableVariant(product: SearchableProduct) {
  return product.variants
    .filter((variant) => variant.isAvailable !== false && product.allowedOptions.sizes.includes(variant.name))
    .sort((a, b) => a.price - b.price)[0] ?? null;
}

function productText(product: SearchableProduct): string {
  return stripNoMilk(fold([
    product.name,
    product.description,
    ...(product.tags ?? []),
    ...(product.ingredientMetadata?.flavorProfile ?? []),
  ].join(' ')));
}

function stripNoMilk(text: string): string {
  // A "without milk" request or description must not become a positive milk keyword.
  return text.replace(/\bkhong\s+(?:co\s+)?sua\b/g, ' ');
}

function classifyGroups(text: string): Set<Group> {
  const groups = new Set<Group>();
  if (/\b(?:ca\s+phe|cafe|coffee|espresso|latte|cappuccino|cold\s*brew|bac\s+xiu)\b/.test(text)) groups.add('coffee');
  if (/\b(?:tra|tea|matcha|oolong)\b/.test(text)) groups.add('tea');
  if (/\b(?:trai\s+cay|fruit|chanh|dao|cam|vai|dau|xoai|berry|chanh\s+day)\b/.test(text)) groups.add('fruit');
  return groups;
}

function tokenMatchScore(keyword: string, text: string, tokens: string[]): number {
  if (tokens.includes(keyword)) return 5;
  if (text.includes(keyword)) return 3;
  if (keyword.length >= 4 && tokens.some((token) => Math.abs(token.length - keyword.length) <= 1 && levenshtein(token, keyword) <= 1)) return 2;
  return 0;
}

function flavorMatches(flavor: Flavor, values: string[]): boolean {
  const patterns: Record<Flavor, RegExp> = {
    sour: /chua|sour|citrus/,
    bitter: /dang|dam|bitter|bold/,
    sweet: /ngot|sweet/,
    light: /thanh|nhe|light|fresh/,
    rich: /beo|ngay|rich|creamy/,
  };
  return values.some((value) => patterns[flavor]!.test(value));
}

function buildReason(product: SearchableProduct, intent: MenuSearchIntent, price: number): string {
  const reasons: string[] = [];
  if (intent.requirements.noCaffeine) reasons.push('metadata xác nhận không caffeine');
  if (intent.requirements.noDairy) reasons.push('metadata xác nhận không sữa');
  if (intent.requirements.budget) reasons.push(`${price.toLocaleString('vi-VN')}đ/món trong ngân sách`);
  if (intent.preferences.lowSugar && product.allowedOptions.sugarLevels.some((level) => /^(0|25)%$/.test(level))) reasons.push('có thể chọn 0–25% đường');
  if (intent.preferences.flavors.length > 0) reasons.push('khẩu vị gần yêu cầu');
  return reasons.slice(0, 2).join(', ') || 'khớp từ khóa trong tên, mô tả hoặc tag';
}

function canonicalizeTypos(value: string): string {
  return value.split(/\s+/).map((token) => {
    if (token.length < 3 || /^\d/.test(token)) return token;
    const exact = KNOWN_TOKENS.find((known) => known === token);
    if (exact) return exact;
    // Three-letter folded words are too ambiguous to fuzz ("qua"→"sua", "lam"→"dam").
    if (token.length < 4) return token;
    const fuzzy = KNOWN_TOKENS.find((known) => Math.abs(known.length - token.length) <= 1 && levenshtein(known, token) <= 1);
    return fuzzy ?? token;
  }).join(' ');
}

function levenshtein(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j < current.length; j += 1) previous[j] = current[j]!;
  }
  return previous[b.length] ?? 0;
}

/** Folded tokens that appear in the public menu text (names, descriptions, tags, flavors). */
export function menuVocabulary(products: readonly SearchableProduct[]): Set<string> {
  const vocabulary = new Set<string>();
  for (const product of products) {
    if (!product.isAvailable || product.isArchived) continue;
    for (const token of productText(product).split(/\s+/)) if (token.length >= 2) vocabulary.add(token);
  }
  return vocabulary;
}

/** True when a folded token exists in the menu vocabulary, allowing one typo for longer words. */
export function isMenuTerm(token: string, vocabulary: ReadonlySet<string>): boolean {
  if (vocabulary.has(token)) return true;
  if (token.length < 4) return false;
  for (const known of vocabulary) {
    if (Math.abs(known.length - token.length) <= 1 && levenshtein(known, token) <= 1) return true;
  }
  return false;
}

export function foldText(value: string): string {
  return fold(value);
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9.,%]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function idOf(value: { toString(): string } | string): string {
  return typeof value === 'string' ? value : value.toString();
}

export type { SearchableProduct };
