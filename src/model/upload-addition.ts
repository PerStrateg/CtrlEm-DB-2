import { parseItems } from './library';
import type { ContentType, Library } from './library';

export interface UploadAddition { categoryId: string; value: string; label: string }
export interface UploadAdditionResult { status: 'saved' | 'missing'; library: Library }

/** Appends against the latest category, without replacing concurrent edits. */
export function addUploadedItem(current: Library, type: ContentType, addition: UploadAddition): UploadAdditionResult {
  const category = current.categories.find(category => category.id === addition.categoryId && category.type === type);
  if (!category) return { status: 'missing', library: current };
  const parsed = parseItems(type, `${addition.value} ${addition.label.replace(/\s+/g, ' ')}`);
  if (parsed.invalidLines.length || parsed.items.length !== 1) throw new Error('Invalid uploaded URL.');
  if (category.items.some(item => item.value === parsed.items[0]!.value)) return { status: 'saved', library: current };
  const library = structuredClone(current);
  const target = library.categories.find(item => item.id === category.id)!;
  target.items.push(parsed.items[0]!);
  target.revision++;
  library.revision++;
  return { status: 'saved', library };
}
