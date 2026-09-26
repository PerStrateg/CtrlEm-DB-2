import { z } from '../shared/validation';
import { contentTypes, emptyLibrary } from './library';
import type { Category, ContentType } from './library';
import { availableCategoryName, exportLibrary, libraryFileSchema } from './library-file';
import type { LibraryFile } from './library-file';
import { normalizeWebAddress } from './web-address';

const legacySchema = z.object({
  version: z.literal(1), exportedAt: z.string().optional(),
  settings: z.object({ autoSave: z.boolean(), autoSendIntervalSeconds: z.number(), minimumRequestIntervalSeconds: z.number() }),
  categories: z.array(z.object({
    id: z.string(), name: z.string().trim().min(1), type: z.enum(contentTypes), previewsEnabled: z.boolean(),
    items: z.array(z.object({ id: z.string(), value: z.string(), label: z.string().optional() })),
  })),
}).strict();

const nativeV1Schema = z.object({
  format: z.literal('ctrlem-db'), version: z.literal(1), categories: libraryFileSchema.shape.categories,
}).strict().transform(file => ({ ...file, version: 3 as const })).pipe(libraryFileSchema);

const legacyTypeMap = { links: 'link', text: 'text', image: 'image', sound: 'sound', video: 'video' } as const satisfies Record<string, ContentType>;
const contentCategories = z.array(z.object({ name: z.string().trim().min(1), content: z.string() }).strict());
const legacyV2Schema = z.object({
  version: z.literal(2), exportedAt: z.string().optional(),
  autoSendIntervalSeconds: z.number(), minimumRequestIntervalSeconds: z.number(),
  types: z.object({ links: contentCategories, text: contentCategories, image: contentCategories,
    sound: contentCategories, video: contentCategories }).strict(),
}).strict();

interface LegacyCategory {
  type: ContentType; name: string; previewsEnabled: boolean;
  items: { value: string; label?: string }[];
}

export interface ImportReview {
  legacy: boolean; originalItems: number; warnings: string[]; exclusions: string[];
}
export interface ReadLibraryImport { file: LibraryFile; review: ImportReview }
export class LibraryImportError extends Error {}

/** Recognizes known file formats and normalizes them before preview or persistence. */
export function readLibraryImport(input: unknown): ReadLibraryImport {
  const native = z.union([libraryFileSchema, nativeV1Schema]).safeParse(input);
  if (native.success) return { file: native.data, review: { legacy: false,
    originalItems: native.data.categories.reduce((count, category) => count + category.items.length, 0), warnings: [], exclusions: [] } };
  const legacy = legacySchema.safeParse(input);
  let categories: LegacyCategory[];
  if (legacy.success) categories = legacy.data.categories;
  else {
    const v2 = legacyV2Schema.safeParse(input);
    if (!v2.success) throw new LibraryImportError('Invalid library file. Choose a CtrlEm DB version 3 or 1 export, or a userscript version 1 or 2 export with valid categories.');
    categories = Object.entries(v2.data.types).flatMap(([key, entries]) => entries.map(category => ({
      type: legacyTypeMap[key as keyof typeof legacyTypeMap], name: category.name, previewsEnabled: true,
      items: category.content.split(/\r\n|\n|\r/).filter(line => line.trim()).map(value => ({ value })),
    })));
  }
  return convertLegacyCategories(categories);
}

function convertLegacyCategories(categories: LegacyCategory[]): ReadLibraryImport {
  const library = emptyLibrary();
  const review: ImportReview = { legacy: true, originalItems: 0, warnings: [], exclusions: [] };
  for (const source of categories) {
    const name = availableCategoryName(library, source.type, source.name);
    if (name !== source.name) review.warnings.push(`${source.name} renamed to ${name}.`);
    const category: Category = { id: crypto.randomUUID(), revision: 1, type: source.type, name,
      previewsEnabled: source.previewsEnabled, items: [] };
    if (source.name.toLowerCase() === 'input' && !library.categories.some(item => item.type === source.type && item.purpose === 'input')) category.purpose = 'input';
    const seen = new Set<string>();
    for (const [index, item] of source.items.entries()) {
      review.originalItems++;
      const raw = item.value.trim();
      if (source.type === 'image' && index === 0 && raw.toLowerCase() === '- (no previews)') {
        category.previewsEnabled = false; review.warnings.push(`${name}: converted the no-previews marker.`); continue;
      }
      let value: string | undefined = raw, label = item.label?.trim() || undefined;
      if (source.type !== 'text' && source.type !== 'link') {
        const match = /^(\S+)(?:\s+([\s\S]+))?$/.exec(raw);
        value = match?.[1]; label ??= match?.[2]?.trim() || undefined;
      }
      if (source.type !== 'text') value = value ? normalizeWebAddress(value) : undefined;
      const reason = !value ? 'empty entry or invalid web address' : /[\r\n]/.test(raw) || (label && /[\r\n]/.test(label))
        ? 'multiple lines in one entry' : label && (source.type === 'text' || source.type === 'link') ? 'labels are not supported for this type' : undefined;
      if (reason) { review.exclusions.push(`${source.type} / ${name}, entry ${index + 1}: ${reason}. Value: ${item.value}`); continue; }
      if (seen.has(value!)) { review.warnings.push(`${name}, entry ${index + 1}: duplicate merged; the first entry is kept.`); continue; }
      seen.add(value!);
      category.items.push({ id: crypto.randomUUID(), value: value!, ...(label ? { label } : {}) });
    }
    library.categories.push(category);
  }
  if (review.exclusions.length && !library.categories.some(category => category.items.length)) {
    throw new LibraryImportError(`No usable entries remain. Nothing was imported. ${review.exclusions.join('\n')}`);
  }
  return { file: libraryFileSchema.parse(exportLibrary(library)), review };
}
