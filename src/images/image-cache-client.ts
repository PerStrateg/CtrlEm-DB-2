import { imageCachePort } from '../shared/image-cache-protocol';
import type { ImageCacheReply } from '../shared/image-cache-protocol';

export interface ImageResource { src: string; release(): void }
export interface ImageLoader {
  acquire(url: string, signal: AbortSignal): Promise<ImageResource>;
  subscribe(changed: () => void): () => void;
}

export class ExtensionImageLoader implements ImageLoader {
  acquire(url: string, signal: AbortSignal): Promise<ImageResource> {
    return new Promise<ImageResource>((resolve, reject) => {
      const port = chrome.runtime.connect({ name: imageCachePort });
      const parts: Uint8Array<ArrayBuffer>[] = [];
      let finished = false;
      const timer = setInterval(() => port.postMessage({ type: 'ping' }), 20_000);
      const cleanup = () => { clearInterval(timer); signal.removeEventListener('abort', abort); port.disconnect(); parts.length = 0; };
      const finish = (blob?: Blob) => {
        if (finished) return;
        finished = true; cleanup();
        const src = blob ? URL.createObjectURL(blob) : url;
        resolve({ src, release: () => { if (blob) URL.revokeObjectURL(src); } });
      };
      const abort = () => { if (finished) return; finished = true; cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
      signal.addEventListener('abort', abort, { once: true });
      port.onDisconnect.addListener(() => { void chrome.runtime.lastError; finish(); });
      port.onMessage.addListener((message: ImageCacheReply) => {
        if (finished) return;
        if (message.type === 'chunk') {
          const binary = atob(message.data);
          parts.push(Uint8Array.from(binary, character => character.charCodeAt(0)));
          port.postMessage({ type: 'ack' });
        } else if (message.type === 'done') finish(new Blob(parts, { type: message.mime }));
        else finish();
      });
      if (signal.aborted) abort(); else port.postMessage({ type: 'get', url });
    }).catch(error => {
      if (signal.aborted) throw error;
      return { src: url, release: () => {} };
    });
  }
  subscribe(changed: () => void): () => void {
    const listener = (message: { type?: string }) => { if (message?.type === 'image-cache:changed') changed(); };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }
}
