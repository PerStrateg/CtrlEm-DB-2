import { imageCacheDefaultBytes } from '../model/image-cache';
import type { ImageCacheStats } from '../model/image-cache';

export interface ImageCacheStore {
  get(url: string): Promise<Blob | undefined>;
  put(url: string, blob: Blob): Promise<void>;
  stats(): Promise<ImageCacheStats>;
  clear(): Promise<void>;
  setLimit(bytes: number): Promise<void>;
}
interface Entry { url: string; size: number; used: number }
const request = <T>(value: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error);
});

/** Blobs and their small eviction index share one transaction, without reading every file. */
export class ImageCacheRepository implements ImageCacheStore {
  private database?: Promise<IDBDatabase>;
  constructor(private readonly factory: IDBFactory = indexedDB) {}
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const opening = this.factory.open('ctrlem-image-cache', 1);
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore('files');
        opening.result.createObjectStore('entries', { keyPath: 'url' }).createIndex('used', 'used');
        opening.result.createObjectStore('settings');
      };
      opening.onerror = () => { this.database = undefined; reject(opening.error); };
      opening.onsuccess = () => resolve(opening.result);
    });
  }
  private async transaction<T>(operation: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(['files', 'entries', 'settings'], 'readwrite');
    const completed = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('Cache transaction aborted.'));
      tx.onerror = () => {}; // The abort event carries transaction failure.
    });
    try { const result = await operation(tx); await completed; return result; }
    catch (error) { try { tx.abort(); } catch { /* Already completed or aborted. */ } await completed.catch(() => {}); throw error; }
  }
  private async readStats(tx: IDBTransaction): Promise<ImageCacheStats> {
    return await request(tx.objectStore('settings').get('stats')) ?? { bytes: 0, count: 0, limit: imageCacheDefaultBytes };
  }
  private async nextUse(tx: IDBTransaction): Promise<number> {
    const settings = tx.objectStore('settings');
    const used = Math.max(Date.now(), (await request(settings.get('lastUse')) ?? 0) + 1);
    settings.put(used, 'lastUse'); return used;
  }
  private trim(tx: IDBTransaction, stats: ImageCacheStats): Promise<void> {
    return new Promise((resolve, reject) => {
      const cursor = tx.objectStore('entries').index('used').openCursor();
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current || stats.bytes <= stats.limit) { resolve(); return; }
        const entry = current.value as Entry;
        tx.objectStore('files').delete(entry.url); current.delete();
        stats.bytes -= entry.size; stats.count--; current.continue();
      };
    });
  }
  get(url: string): Promise<Blob | undefined> {
    return this.transaction(async tx => {
      const entry: Entry | undefined = await request(tx.objectStore('entries').get(url));
      if (!entry) return;
      entry.used = await this.nextUse(tx); tx.objectStore('entries').put(entry);
      return request(tx.objectStore('files').get(url));
    });
  }
  put(url: string, blob: Blob): Promise<void> {
    return this.transaction(async tx => {
      const stats = await this.readStats(tx);
      if (blob.size > stats.limit) return;
      const previous: Entry | undefined = await request(tx.objectStore('entries').get(url));
      stats.bytes += blob.size - (previous?.size ?? 0); if (!previous) stats.count++;
      const used = await this.nextUse(tx);
      tx.objectStore('files').put(blob, url);
      tx.objectStore('entries').put({ url, size: blob.size, used } satisfies Entry);
      await this.trim(tx, stats); tx.objectStore('settings').put(stats, 'stats');
    });
  }
  stats(): Promise<ImageCacheStats> { return this.transaction(tx => this.readStats(tx)); }
  clear(): Promise<void> {
    return this.transaction(async tx => {
      const stats = await this.readStats(tx);
      tx.objectStore('files').clear(); tx.objectStore('entries').clear();
      tx.objectStore('settings').put({ ...stats, bytes: 0, count: 0 }, 'stats');
    });
  }
  setLimit(limit: number): Promise<void> {
    return this.transaction(async tx => {
      const stats = { ...await this.readStats(tx), limit };
      await this.trim(tx, stats); tx.objectStore('settings').put(stats, 'stats');
    });
  }
}
