import { remoteMediaUploadPort } from '../../shared/media-library-protocol';
import type { MediaKind } from '../domain/media-resource';
import type { MediaCategory, MediaLibraryPort, MediaLibraryProgress } from '../ports/media-library-port';

interface UploadedMedia { sourceUrl: string; kind: MediaKind; uploadedUrl: string; label: string }

export class ExtensionMediaLibraryClient implements MediaLibraryPort {
  /** Last successful external upload, so a repeated save never uploads the same file twice. */
  private uploaded: UploadedMedia | undefined;
  async categories(kind: MediaKind): Promise<MediaCategory[]> {
    const reply = await chrome.runtime.sendMessage({ type: 'media-library:categories', kind });
    if (!reply?.ok) throw new Error(reply?.error ?? 'Couldn’t load categories.'); return reply.value;
  }
  save(url: string, kind: MediaKind, categoryId: string, progress: (value: MediaLibraryProgress) => void): Promise<void> {
    const resumed = this.uploaded?.sourceUrl === url && this.uploaded.kind === kind ? this.uploaded : undefined;
    return this.run({ kind, url }, categoryId, resumed, progress);
  }
  private run(resource: { kind: MediaKind; url: string }, categoryId: string, resumed: UploadedMedia | undefined,
    progress: (value: MediaLibraryProgress) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: remoteMediaUploadPort }); let settled = false;
      port.onMessage.addListener(message => {
        if (message.type === 'uploaded') { this.uploaded = { sourceUrl: resource.url, kind: resource.kind, uploadedUrl: message.value, label: message.label }; return; }
        if (message.type === 'progress') progress(message.value);
        if (message.type === 'result') { settled = true; port.disconnect(); message.ok ? resolve() : reject(new Error(message.error)); }
      });
      port.onDisconnect.addListener(() => { if (!settled) reject(new Error('Upload stopped. Retry.')); });
      port.postMessage({ type: 'save', resource: { id: `${resource.kind}:${resource.url}`, kind: resource.kind, url: resource.url }, categoryId,
        ...(resumed ? { uploadedUrl: resumed.uploadedUrl, uploadedLabel: resumed.label } : {}) });
    });
  }
}
