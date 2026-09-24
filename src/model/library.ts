export const contentTypes = ['link', 'text', 'image', 'sound', 'video'] as const;
export type ContentType = typeof contentTypes[number];
export const typeLabels: Record<ContentType, string> = {
  link: 'Links', text: 'Text', image: 'Images', sound: 'Sounds', video: 'Videos',
};
export interface Item { id: string; value: string; label?: string }
export interface Category {
  id: string; type: ContentType; name: string; revision: number;
  items: Item[]; previewsEnabled: boolean; purpose?: 'input';
}
export interface Library { version: 1; revision: number; categories: Category[] }
export const emptyLibrary = (): Library => ({ version: 1, revision: 0, categories: [] });

export function categoryNameError(library: Library, type: ContentType, name: string, id?: string): string | undefined {
  if (!name.trim()) return 'Enter a category name.';
  if (library.categories.some(category => category.id !== id && category.type === type &&
      category.name.toLowerCase() === name.trim().toLowerCase())) return 'This name is already in use.';
}

export function formatItems(items: Item[]): string {
  return items.map(item => item.label ? `${item.value} ${item.label}` : item.value).join('\n');
}

export function parseItems(type: ContentType, text: string, previous: Item[] = []): { items: Item[]; invalidLines: number[] } {
  const items: Item[] = [];
  const invalidLines: number[] = [];
  const seen = new Set<string>();
  const identities = new Map(previous.map(item => [JSON.stringify([item.value, item.label]), item.id]));
  for (const [index, source] of text.split(/\r?\n/).entries()) {
    const line = source.trim();
    if (!line) continue;
    const separator = type === 'text' || type === 'link' ? -1 : line.search(/\s/);
    const value = separator < 0 ? line : line.slice(0, separator);
    const label = separator < 0 ? undefined : line.slice(separator).trim() || undefined;
    if (type !== 'text') {
      // URL() accepts embedded whitespace, which is not a valid editor URL token.
      if (/\s/.test(value) || !/^https?:\/\//i.test(value) || !URL.canParse(value)) {
        invalidLines.push(index + 1);
        continue;
      }
    }
    if (seen.has(value)) continue;
    seen.add(value);
    const identity = JSON.stringify([value, label]);
    items.push({ id: identities.get(identity) ?? crypto.randomUUID(), value, ...(label ? { label } : {}) });
  }
  return { items, invalidLines };
}

export type LibraryChange =
  | { kind: 'create'; type: ContentType; name: string }
  | { kind: 'update'; id: string; baseRevision: number; name?: string; text?: string; previewsEnabled?: boolean }
  | { kind: 'delete'; id: string; baseRevision: number }
  | { kind: 'move'; id: string; baseRevision: number; beforeId: string | null };
export type ChangeResult = { status: 'saved' | 'conflict'; library: Library; categoryId: string };

export function applyChange(current: Library, change: LibraryChange): ChangeResult {
  const library = structuredClone(current);
  if (change.kind === 'create') {
    const error = categoryNameError(current, change.type, change.name);
    if (error) throw new Error(error);
    const category: Category = {
      id: crypto.randomUUID(), type: change.type, name: change.name.trim(), revision: 1,
      items: [], previewsEnabled: true,
    };
    library.categories.push(category);
    library.revision++;
    return { status: 'saved', library, categoryId: category.id };
  }
  const index = library.categories.findIndex(category => category.id === change.id);
  const category = library.categories[index];
  if (!category || category.revision !== change.baseRevision) {
    return { status: 'conflict', library: current, categoryId: change.id };
  }
  if (change.kind === 'delete') library.categories.splice(index, 1);
  if (change.kind === 'update') {
    if (change.name !== undefined) {
      const error = categoryNameError(current, category.type, change.name, category.id);
      if (error) throw new Error(error);
      category.name = change.name.trim();
    }
    if (change.text !== undefined) {
      const parsed = parseItems(category.type, change.text, category.items);
      if (parsed.invalidLines.length) throw new Error(`Invalid lines: ${parsed.invalidLines.join(', ')}.`);
      category.items = parsed.items;
    }
    if (change.previewsEnabled !== undefined) category.previewsEnabled = change.previewsEnabled;
  }
  if (change.kind === 'move') {
    const target = library.categories.find(item => item.id === change.beforeId);
    if (change.beforeId === category.id || (change.beforeId !== null && (!target || target.type !== category.type))) {
      throw new Error('Choose a category of the same type.');
    }
    library.categories.splice(index, 1);
    const targetIndex = change.beforeId === null ? library.categories.length : library.categories.findIndex(item => item.id === change.beforeId);
    library.categories.splice(targetIndex, 0, category);
  }
  category.revision++;
  library.revision++;
  return { status: 'saved', library, categoryId: category.id };
}
