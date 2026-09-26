import { initialFiles } from '../model/files';
import type { FilesSnapshot, FilePart, LocalImage } from '../model/files';

const result = <T>(r: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
});

/** Permanent local originals, separate from the disposable network image cache. Background owns writes. */
export class FilesRepository {
  private database?: Promise<IDBDatabase>;
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const r = indexedDB.open('ctrlem-files', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('blobs'); r.result.createObjectStore('state'); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => { this.database = undefined; reject(r.error); };
    });
  }
  private async transaction<T>(mode: IDBTransactionMode, action: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const tx = (await this.open()).transaction(['state', 'blobs'], mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('File storage interrupted.'));
      tx.onerror = () => {};
    });
    try { const value = await action(tx); await done; return value; }
    catch (error) { try { tx.abort(); } catch { /* Transaction already finished. */ } await done.catch(() => {}); throw error; }
  }
  read(): Promise<FilesSnapshot> {
    return this.transaction('readwrite', async tx => {
      const store = tx.objectStore('state');
      const saved = await result<FilesSnapshot | undefined>(store.get('collection'));
      if (saved) return saved;
      const state = initialFiles(); store.put(state, 'collection'); return state;
    });
  }
  get(id: string, part: FilePart): Promise<Blob | undefined> {
    return this.transaction('readonly', tx => result(tx.objectStore('blobs').get(`${id}:${part}`)));
  }
  async update(change: (state: FilesSnapshot) => void): Promise<FilesSnapshot> {
    return this.transaction('readwrite', async tx => {
      const store = tx.objectStore('state'); const state: FilesSnapshot = await result(store.get('collection')) ?? initialFiles();
      change(state); store.put(state, 'collection'); return state;
    });
  }
  put(generation: string, id: string, part: FilePart, blob: Blob, meta?: Omit<LocalImage, 'id' | 'order'>): Promise<void> {
    return this.transaction('readwrite', async tx => {
      const store = tx.objectStore('state'); const state: FilesSnapshot = await result(store.get('collection'));
      if (state.generation !== generation) throw new Error('The collection was cleared.');
      if (part === 'original') {
        if (state.items.some(item => item.id === id)) return;
        state.items.push({ ...meta!, id, order: state.items.length });
      } else if (!state.items.some(item => item.id === id)) throw new Error('File no longer available.');
      tx.objectStore('blobs').put(blob, `${id}:${part}`); store.put(state, 'collection');
    });
  }
  clear(): Promise<void> {
    return this.transaction('readwrite', async tx => {
      tx.objectStore('blobs').clear(); tx.objectStore('state').put(initialFiles(), 'collection');
    });
  }
}
