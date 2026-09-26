import { z } from '../shared/validation';
import { categoryNameError, contentTypes } from './library';
import type { Category, Library } from './library';
import { normalizeWebAddress } from './web-address';

const fileCategory = z.object({
  id: z.string().uuid(), type: z.enum(contentTypes), name: z.string().trim().min(1),
  items: z.array(z.object({ id: z.string().uuid(), value: z.string().trim().min(1), label: z.string().trim().min(1).optional() }).strict()),
  previewsEnabled: z.boolean(), purpose: z.literal('input').optional(),
}).strict();
export const libraryFileSchema = z.object({
  format: z.literal('ctrlem-db'), version: z.literal(1), categories: z.array(fileCategory),
}).strict().superRefine((file, context) => {
  const ids = new Set<string>();
  const names = new Set<string>();
  const purposes = new Set<string>();
  for (const category of file.categories) {
    const name = JSON.stringify([category.type, category.name.toLowerCase()]);
    if (ids.has(category.id) || names.has(name) || (category.purpose && purposes.has(category.type))) {
      context.addIssue({ code: 'custom', message: 'Duplicate category identity, name or Input purpose.' });
    }
    ids.add(category.id); names.add(name);
    if (category.purpose) purposes.add(category.type);
    const values = new Set<string>();
    for (const item of category.items) {
      const value = category.type === 'text' ? item.value : normalizeWebAddress(item.value);
      if (!value || /[\r\n]/.test(item.value) || (item.label && (['text', 'link'].includes(category.type) || /[\r\n]/.test(item.label))) || ids.has(item.id) || values.has(value)) {
        context.addIssue({ code: 'custom', message: 'Invalid or duplicate entry.' });
      }
      ids.add(item.id);
      if (value) values.add(value);
    }
  }
});
export type LibraryFile = z.infer<typeof libraryFileSchema>;
export type ImportMode = 'append' | 'replace';
export interface ImportPlan { categories: Category[]; baseRevision: number; warnings: string[] }
export interface ImportResult { status: 'saved' | 'conflict'; library: Library; categoryIds: string[] }

export function exportLibrary(library: Library): LibraryFile {
  return { format: 'ctrlem-db', version: 1, categories: library.categories.map(({ id, type, name, items, previewsEnabled, purpose }) =>
    ({ id, type, name, items: items.map(({ id, value, label }) => ({ id, value, ...(label ? { label } : {}) })), previewsEnabled, ...(purpose ? { purpose } : {}) })) };
}

export function availableCategoryName(library: Library, type: Category['type'], name: string): string {
  let candidate = name;
  for (let suffix = 2; categoryNameError(library, type, candidate); suffix++) candidate = `${name} (${suffix})`;
  return candidate;
}

export function planImport(library: Library, file: LibraryFile, mode: ImportMode): ImportPlan {
  const target: Library = { ...library, categories: mode === 'replace' ? [] : [...library.categories] };
  const categories: Category[] = [], warnings: string[] = [];
  for (const source of file.categories) {
    const category: Category = { ...source, id: crypto.randomUUID(), revision: 1,
      name: availableCategoryName(target, source.type, source.name),
      items: source.items.map(item => ({ ...item, id: crypto.randomUUID(),
        value: source.type === 'text' ? item.value : normalizeWebAddress(item.value)! })) };
    if (category.purpose && target.categories.some(item => item.type === category.type && item.purpose === 'input')) {
      delete category.purpose;
      warnings.push(`${category.name} will be imported as a regular category; this type already has Input.`);
    }
    categories.push(category); target.categories.push(category);
  }
  return { categories, baseRevision: library.revision, warnings };
}
