import { z } from '../shared/validation';
import { contentTypes, emptyLibrary } from './library';
import type { Category } from './library';
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

export interface ImportReview {
  legacy: boolean; originalItems: number; warnings: string[]; exclusions: string[];
}
export interface ReadLibraryImport { file: LibraryFile; review: ImportReview }
export class LibraryImportError extends Error {}

/** Converts only the known userscript AppExport. The native format stays strict. */
export function readLibraryImport(input: unknown): ReadLibraryImport {
  const native = libraryFileSchema.safeParse(input);
  if (native.success) return { file: native.data, review: { legacy: false,
    originalItems: native.data.categories.reduce((count, category) => count + category.items.length, 0), warnings: [], exclusions: [] } };
  const legacy = legacySchema.safeParse(input);
  if (!legacy.success) throw new LibraryImportError('Invalid library file. Choose a CtrlEm DB version 1 export or a userscript version 1 export with valid categories.');
  const library = emptyLibrary();
  const review: ImportReview = { legacy: true, originalItems: 0, warnings: [], exclusions: [] };
  for (const source of legacy.data.categories) {
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
