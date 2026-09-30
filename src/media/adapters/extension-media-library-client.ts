import { remoteMediaUploadPort } from '../../shared/media-library-protocol';
import type { MediaKind } from '../domain/media-resource';
import type { MediaCategory, MediaLibraryPort, MediaLibraryProgress } from '../ports/media-library-port';

export class ExtensionMediaLibraryClient implements MediaLibraryPort {
  async categories(kind: MediaKind): Promise<MediaCategory[]> {
    const reply = await chrome.runtime.sendMessage({ type: 'media-library:categories', kind });
    if (!reply?.ok) throw new Error(reply?.error ?? 'Couldn’t load categories.'); return reply.value;
  }
  save(url: string, kind: MediaKind, categoryId: string, progress: (value: MediaLibraryProgress) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: remoteMediaUploadPort }); let settled = false;
      port.onMessage.addListener(message => {
        if (message.type === 'progress') progress(message.value);
        if (message.type === 'result') { settled = true; port.disconnect(); message.ok ? resolve() : reject(new Error(message.error)); }
      });
      port.onDisconnect.addListener(() => { if (!settled) reject(new Error('Upload stopped. Retry.')); });
      port.postMessage({ type: 'save', resource: { id: `${kind}:${url}`, kind, url }, categoryId });
    });
  }
}
