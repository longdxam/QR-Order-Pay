export interface Variant {
  _id?: string;
  name: string;
  price: number;
  isAvailable: boolean;
}

export interface AdminProduct {
  _id: string;
  categoryId: string;
  name: string;
  description: string;
  image: string;
  basePrice: number;
  variants: Variant[];
  isAvailable: boolean;
  isArchived: boolean;
  isFeatured: boolean;
  tags: string[];
  toppingIds?: string[];
  ingredientMetadata?: {
    caffeine: boolean;
    dairy: boolean;
    flavorProfile: string[];
    allergens?: string[];
    notes?: string;
  };
  allowedOptions?: {
    sizes?: string[];
    sugarLevels?: string[];
    iceLevels?: string[];
    toppingIds?: string[];
  };
}

export interface Category {
  _id: string;
  name: string;
  slug: string;
  isActive: boolean;
}

export interface FormState {
  name: string;
  description: string;
  image: string;
  basePrice: string;
  variants: Variant[];
  isAvailable: boolean;
  isFeatured: boolean;
  isArchived: boolean;
  categoryId: string;
  tagInput: string;
}

export interface TagSuggestions {
  mode: 'llm' | 'fallback';
  tags: string[];
}

export const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  image: '',
  basePrice: '35000',
  variants: [{ name: 'M', price: 35000, isAvailable: true }],
  isAvailable: true,
  isFeatured: false,
  isArchived: false,
  categoryId: '',
  tagInput: '',
};

const DEFAULT_SUGAR_LEVELS = ['0%', '30%', '50%', '70%', '100%'];
const DEFAULT_ICE_LEVELS = ['no-ice', 'less-ice', 'normal-ice'];

export function parseTags(value: string): string[] {
  return value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** So khớp tên món không dấu, không phân biệt hoa thường và khoảng trắng thừa. */
export function normalizeProductName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .trim()
    .replace(/\s+/g, ' ');
}

export function formFromProduct(p: AdminProduct): FormState {
  return {
    name: p.name,
    description: p.description,
    image: p.image,
    basePrice: String(p.basePrice),
    variants: p.variants.length
      ? p.variants
      : [{ name: 'M', price: p.basePrice, isAvailable: true }],
    isAvailable: p.isAvailable,
    isFeatured: p.isFeatured,
    isArchived: p.isArchived,
    categoryId: p.categoryId,
    tagInput: p.tags.join(', '),
  };
}

/**
 * Payload cho POST/PATCH `/admin/products`. Form không sửa các trường tùy chọn đường/đá/topping và
 * metadata nguyên liệu: với món đang sửa thì giữ nguyên giá trị hiện có, với món mới thì dùng mặc định.
 */
export function buildProductPayload(form: FormState, existing: AdminProduct | null) {
  return {
    name: form.name,
    description: form.description,
    image: form.image,
    basePrice: Number(form.basePrice),
    variants: form.variants.map((v) => ({
      ...(v._id ? { _id: v._id } : {}),
      name: v.name,
      price: Number(v.price),
      isAvailable: v.isAvailable,
    })),
    isAvailable: form.isAvailable,
    isFeatured: form.isFeatured,
    isArchived: form.isArchived,
    tags: parseTags(form.tagInput),
    categoryId: form.categoryId || undefined,
    allowedOptions: {
      sizes: Array.from(new Set(form.variants.map((v) => v.name))),
      sugarLevels: existing ? (existing.allowedOptions?.sugarLevels ?? []) : DEFAULT_SUGAR_LEVELS,
      iceLevels: existing ? (existing.allowedOptions?.iceLevels ?? []) : DEFAULT_ICE_LEVELS,
      toppingIds: existing ? (existing.allowedOptions?.toppingIds ?? []) : [],
    },
    toppingIds: existing ? (existing.toppingIds ?? []) : [],
    ingredientMetadata: existing
      ? existing.ingredientMetadata
      : { caffeine: false, dairy: false, flavorProfile: [], allergens: [], notes: '' },
  };
}

/** Gộp tag gợi ý vào ô nhập, bỏ tag đã có; trả về danh sách gợi ý còn lại. */
export function mergeSuggestedTags(
  form: FormState,
  suggestions: TagSuggestions | null,
  tags: string[],
): { form: FormState; suggestions: TagSuggestions | null } {
  const current = parseTags(form.tagInput);
  const next = [...current, ...tags.filter((tag) => !current.includes(tag))];
  return {
    form: { ...form, tagInput: next.join(', ') },
    suggestions: suggestions
      ? { ...suggestions, tags: suggestions.tags.filter((tag) => !tags.includes(tag)) }
      : suggestions,
  };
}
