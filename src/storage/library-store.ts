import { applyChange, emptyLibrary } from '../model/library';
import type { ChangeResult, Library, LibraryChange } from '../model/library';
import { emptySession, librarySchema, sessionSchema } from '../shared/library-protocol';
import type { EditorSession } from '../shared/library-protocol';
import { captureInput } from '../model/input-capture';
import type { CaptureResult } from '../model/input-capture';
import { planImport } from '../model/library-file';
import type { ImportMode, ImportResult, LibraryFile } from '../model/library-file';
import type { ContentType } from '../model/library';

export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}
export const libraryKey = 'ctrlem.library';
const sessionKey = (tabId: number) => `ctrlem.editor.${tabId}`;
export class LibraryReadError extends Error {}

export class LibraryRepository {
  constructor(private readonly storage: StorageArea) {}
  async read(): Promise<Library> {
    const data = (await this.storage.get(libraryKey))[libraryKey];
    if (data === undefined) return emptyLibrary();
    const parsed = librarySchema.safeParse(data);
    if (!parsed.success) throw new LibraryReadError('Unsupported or damaged library. Stored data has not been changed.');
    return parsed.data;
  }
  async change(change: LibraryChange): Promise<ChangeResult> {
    const result = applyChange(await this.read(), change);
    if (result.status === 'saved') await this.storage.set({ [libraryKey]: result.library });
    return result;
  }
  async capture(type: ContentType, value: string): Promise<CaptureResult> {
    const result = captureInput(await this.read(), type, value);
    if (result.status === 'saved') await this.storage.set({ [libraryKey]: result.library });
    return result;
  }
  async import(file: LibraryFile, mode: ImportMode, baseRevision: number): Promise<ImportResult> {
    const current = await this.read();
    if (current.revision !== baseRevision) return { status: 'conflict', library: current, categoryIds: [] };
    const plan = planImport(current, file, mode);
    const library: Library = { ...current, revision: current.revision + 1,
      categories: mode === 'replace' ? plan.categories : [...current.categories, ...plan.categories] };
    await this.storage.set({ [libraryKey]: library });
    return { status: 'saved', library, categoryIds: plan.categories.map(category => category.id) };
  }
}

export class EditorSessionRepository {
  constructor(private readonly storage: StorageArea) {}
  async read(tabId: number): Promise<EditorSession> {
    const data = (await this.storage.get(sessionKey(tabId)))[sessionKey(tabId)];
    return data === undefined ? emptySession() : sessionSchema.parse(data);
  }
  save(tabId: number, session: EditorSession): Promise<void> {
    return this.storage.set({ [sessionKey(tabId)]: session });
  }
  remove(tabId: number): Promise<void> { return this.storage.remove(sessionKey(tabId)); }
}

/** Serializes read-modify-write operations across tabs, including after a failed write. */
export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
