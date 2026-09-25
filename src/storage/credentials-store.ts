import type { CredentialId, Credentials } from '../shared/credentials-protocol';
import type { StorageArea } from './library-store';

// IndexedDB belongs to the extension origin; content scripts use the site's origin.
// Keep the non-extractable key out of storage.local, which Firefox exposes to content scripts.
export function openCredentialKey(): Promise<CryptoKey> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ctrlem-private', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      const db = request.result;
      try {
        const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        const tx = db.transaction('keys', 'readwrite');
        const store = tx.objectStore('keys');
        const read = store.get('credentials');
        let key: CryptoKey;
        read.onsuccess = () => {
          key = read.result ?? candidate;
          if (!read.result) store.put(key, 'credentials');
        };
        tx.oncomplete = () => { db.close(); resolve(key); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      } catch (error) { db.close(); reject(error); }
    };
  });
}

export class CredentialsRepository {
  constructor(private readonly storage: StorageArea, private readonly getKey: () => Promise<CryptoKey>) {}

  async read(): Promise<Credentials> {
    return { imgbb: await this.readField('imgbb'), catbox: await this.readField('catbox') };
  }

  async readField(field: CredentialId): Promise<string> {
    const name = `ctrlem.credentials.${field}`;
    const data = (await this.storage.get(name))[name] as { iv: number[]; ciphertext: number[] } | undefined;
    if (data === undefined) return '';
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(data.iv),
      additionalData: new TextEncoder().encode(field) }, await this.getKey(), new Uint8Array(data.ciphertext));
    return new TextDecoder().decode(plain);
  }

  async save(field: CredentialId, value: string): Promise<void> {
    const name = `ctrlem.credentials.${field}`;
    if (!value) { await this.storage.remove(name); return; }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
      additionalData: new TextEncoder().encode(field) }, await this.getKey(), new TextEncoder().encode(value));
    await this.storage.set({ [name]: { iv: [...iv], ciphertext: [...new Uint8Array(ciphertext)] } });
  }
}
