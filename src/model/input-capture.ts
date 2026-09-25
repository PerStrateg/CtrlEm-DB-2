import type { ContentType, Library } from './library';
import { availableCategoryName } from './library-file';
import { normalizeWebAddress } from './web-address';

export interface CaptureResult { status: 'saved' | 'skipped'; library: Library }
export function captureInput(current: Library, type: ContentType, source: string): CaptureResult {
  const raw = source.trim();
  const value = type === 'text' ? raw : normalizeWebAddress(raw);
  if (!value || /[\r\n]/.test(value) || current.categories.some(category => category.type === type && category.items.some(item => item.value === value))) {
    return { status: 'skipped', library: current };
  }
  const library = structuredClone(current);
  let category = library.categories.find(category => category.type === type && category.purpose === 'input');
  if (!category) {
    category = { id: crypto.randomUUID(), type, name: availableCategoryName(library, type, 'Input'),
      revision: 0, items: [], previewsEnabled: true, purpose: 'input' };
    library.categories.push(category);
  }
  category.items.push({ id: crypto.randomUUID(), value });
  category.revision++; library.revision++;
  return { status: 'saved', library };
}
