import { z } from 'zod';
import type { AIProviderMessage } from '../providers/aiProvider.js';
import { BARISTA_INTENT_PROMPT, MENU_TAG_PROMPT } from './baristaSkill.js';
import { isVocabularyTag, normalizeTag } from './menuTagVocabulary.js';

export interface BaristaIntentContext {
  prompt: string;
  budget: number | null;
  preferences: { noCaffeine?: boolean; noDairy?: boolean; lowSugar?: boolean; flavor?: string };
  tagVocabulary: string[];
}

const group = z.enum(['coffee', 'tea', 'fruit']);
const flavor = z.enum(['sour', 'bitter', 'sweet', 'light', 'rich']);
const shortText = z.string().trim().min(1).max(40);

// Unknown enum values are dropped instead of failing the whole intent; shape errors still fail.
const lenientArray = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .array(z.unknown())
    .max(20)
    .default([])
    .transform((values) =>
      values
        .flatMap((value) => {
          const parsed = item.safeParse(value);
          return parsed.success ? [parsed.data as z.infer<T>] : [];
        })
        .slice(0, max),
    );

const intentResponseSchema = z.object({
  groupsInclude: lenientArray(group, 3),
  groupsExclude: lenientArray(group, 3),
  flavors: lenientArray(flavor, 5),
  tags: lenientArray(shortText, 4),
  keywords: lenientArray(shortText, 5),
  noCaffeine: z.boolean().default(false),
  noDairy: z.boolean().default(false),
  lowSugar: z.boolean().default(false),
  maxBudget: z.number().int().positive().max(10_000_000).nullable().default(null),
  message: z.string().trim().min(1).max(300),
  followUpQuestion: z.string().trim().min(1).max(200).optional(),
});

export type BaristaIntent = z.infer<typeof intentResponseSchema>;

export function beforeBaristaRequest(context: BaristaIntentContext): AIProviderMessage[] {
  return [
    { role: 'system', content: BARISTA_INTENT_PROMPT },
    { role: 'user', content: JSON.stringify(context) },
  ];
}

export function afterBaristaResponse(raw: string): BaristaIntent {
  const validated = intentResponseSchema.safeParse(parseJsonObject(raw));
  if (!validated.success) throw new Error('AI schema invalid');
  const intent = validated.data;
  // Groups the guest excluded can never also be preferred.
  intent.groupsInclude = intent.groupsInclude.filter(
    (item) => !intent.groupsExclude.includes(item),
  );
  return intent;
}

export interface MenuTagContext {
  name: string;
  description: string;
  category: string | null;
  flavorProfile: string[];
  caffeine: boolean | null;
  dairy: boolean | null;
  currentTags: string[];
  tagVocabulary: string[];
}

const tagResponseSchema = z.object({ tags: z.array(z.unknown()).max(20) });

export function beforeMenuTagRequest(context: MenuTagContext): AIProviderMessage[] {
  return [
    { role: 'system', content: MENU_TAG_PROMPT },
    { role: 'user', content: JSON.stringify(context) },
  ];
}

/** Keeps only vocabulary tags; anything the model invents is discarded. */
export function afterMenuTagResponse(raw: string): string[] {
  const validated = tagResponseSchema.safeParse(parseJsonObject(raw));
  if (!validated.success) throw new Error('AI schema invalid');
  const tags = validated.data.tags
    .filter((value): value is string => typeof value === 'string')
    .map(normalizeTag)
    .filter(isVocabularyTag);
  return [...new Set(tags)].slice(0, 5);
}

function parseJsonObject(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const object = /\{[\s\S]*\}/.exec(raw);
    if (!object) throw new Error('AI schema invalid');
    try {
      return JSON.parse(object[0]);
    } catch {
      throw new Error('AI schema invalid');
    }
  }
}
