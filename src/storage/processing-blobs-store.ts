/** Disposable blobs cross Chromium's JSON-only ports through IndexedDB. */
export class ProcessingBlobsRepository {
  private database?: Promise<IDBDatabase>;
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('ctrlem-processing-blobs', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('jobs');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.database = undefined; reject(request.error); };
    });
  }
  private async transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const transaction = (await this.open()).transaction('jobs', mode);
    const request = action(transaction.objectStore('jobs'));
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? new Error('Image processing storage interrupted.'));
      transaction.onerror = () => {};
    });
  }
  get(token: string): Promise<Blob | undefined> { return this.transaction('readonly', store => store.get(token)); }
  async put(token: string, blob: Blob): Promise<void> { await this.transaction('readwrite', store => store.put(blob, token)); }
  async remove(token: string): Promise<void> { await this.transaction('readwrite', store => store.delete(token)); }
  async clear(): Promise<void> { await this.transaction('readwrite', store => store.clear()); }
}
