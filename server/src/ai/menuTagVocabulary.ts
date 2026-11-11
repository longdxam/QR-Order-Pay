/**
 * Fixed tag vocabulary shared by offline tag enrichment (Admin reviews AI suggestions before saving)
 * and the intent extractor. Tags describe mood, weather, time and taste only; they never claim
 * health benefits or allergen safety. Caffeine/dairy stay in ingredientMetadata, not in tags.
 */
export const MENU_TAG_VOCABULARY = [
  'mát lạnh',
  'ấm nóng',
  'sảng khoái',
  'tỉnh táo',
  'thư giãn',
  'ngày nóng',
  'ngày mưa',
  'buổi sáng',
  'buổi chiều',
  'buổi tối',
  'đậm vị',
  'thanh nhẹ',
  'béo ngậy',
  'chua nhẹ',
  'ngọt dịu',
  'hương trái cây',
  'hương hoa',
  'dễ uống',
  'tráng miệng',
  'làm việc',
  'học bài',
  'hẹn hò',
  'đi nhóm',
] as const;

/**
 * Soft hints so a requested tag still steers ranking before products have been tagged:
 * "tỉnh táo" prefers coffee/tea, taste tags map to flavor preferences. Never hard filters.
 */
export const TAG_HINTS: Partial<
  Record<
    (typeof MENU_TAG_VOCABULARY)[number],
    {
      groups?: Array<'coffee' | 'tea' | 'fruit'>;
      flavors?: Array<'sour' | 'bitter' | 'sweet' | 'light' | 'rich'>;
    }
  >
> = {
  'tỉnh táo': { groups: ['coffee', 'tea'] },
  'đậm vị': { flavors: ['bitter'] },
  'thanh nhẹ': { flavors: ['light'] },
  'béo ngậy': { flavors: ['rich'] },
  'chua nhẹ': { flavors: ['sour'] },
  'ngọt dịu': { flavors: ['sweet'] },
  'hương trái cây': { groups: ['fruit'] },
};

/** Upper bound on extra menu tags sent to the intent extractor, so its cost stays fixed. */
export const INTENT_TAG_LIMIT = 60;

export function normalizeTag(value: string): string {
  return value.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

const VOCABULARY_SET = new Set<string>(MENU_TAG_VOCABULARY);

export function isVocabularyTag(value: string): boolean {
  return VOCABULARY_SET.has(normalizeTag(value));
}
