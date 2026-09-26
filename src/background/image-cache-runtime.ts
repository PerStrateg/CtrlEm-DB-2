import { authorizedTab } from './library-service';
import { authorizedSettings } from '../shared/credentials-protocol';
import { ImageCacheRepository } from '../storage/image-cache-store';
import { ImageCacheService } from './image-cache-service';
import { WriteQueue } from '../storage/library-store';
import { imageCacheAccess, imageCacheChunkBytes, imageCachePort, imageCacheSettingsRequest, imageCacheUrl } from '../shared/image-cache-protocol';
import type { ImageCacheReply } from '../shared/image-cache-protocol';

export function registerImageCache(): void {
  const store = new ImageCacheRepository();
  const allowed = () => chrome.permissions.contains(imageCacheAccess);
  const service = new ImageCacheService(store, allowed);
  const settingsQueue = new WriteQueue();
  const ports = new Map<chrome.runtime.Port, () => void>();
  const notify = async () => {
    const tabs = await chrome.tabs.query({ url: ['https://ctrlem.com/u/*', 'https://ctrlem.com/groups/*'] });
    await Promise.all(tabs.map(tab => tab.id === undefined ? undefined :
      chrome.tabs.sendMessage(tab.id, { type: 'image-cache:changed' }).catch(() => {})));
  };
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== imageCachePort) return;
    if (!port.sender || authorizedTab(port.sender, chrome.runtime.id) === undefined) { port.disconnect(); return; }
    let connected = true, started = false;
    let release: (() => void) | undefined, acknowledge: (() => void) | undefined;
    const send = (message: ImageCacheReply) => { if (connected) port.postMessage(message); };
    const close = () => {
      connected = false; ports.delete(port); release?.(); acknowledge?.();
    };
    ports.set(port, () => { close(); port.disconnect(); });
    port.onDisconnect.addListener(close);
    port.onMessage.addListener((message: unknown) => {
      const input = message as { type?: string; url?: string };
      if (input?.type === 'ack') { acknowledge?.(); acknowledge = undefined; return; }
      if (input?.type === 'ping') return;
      if (started || input?.type !== 'get') return;
      started = true;
      const parsed = imageCacheUrl.safeParse(input.url);
      if (!parsed.success) { send({ type: 'direct' }); return; }
      const lease = service.acquire(parsed.data); release = lease.release;
      void lease.result.then(async blob => {
        if (!connected) return;
        if (!blob) { send({ type: 'direct' }); return; }
        for (let offset = 0; offset < blob.size && connected; offset += imageCacheChunkBytes) {
          const bytes = new Uint8Array(await blob.slice(offset, offset + imageCacheChunkBytes).arrayBuffer());
          let binary = '';
          for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
          if (!connected) return;
          await new Promise<void>(resolve => { acknowledge = resolve; send({ type: 'chunk', data: btoa(binary) }); });
        }
        send({ type: 'done', mime: blob.type });
      }).catch(() => send({ type: 'direct' }));
    });
  });
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!(message as { type?: string })?.type?.startsWith('image-cache:')) return false;
    const parsed = imageCacheSettingsRequest.safeParse(message);
    if (!authorizedSettings(sender, chrome.runtime.id, chrome.runtime.getURL('settings.html')) || !parsed.success) {
      respond({ ok: false, error: 'Request not allowed.' }); return false;
    }
    void settingsQueue.run(async () => {
      if (parsed.data.type === 'image-cache:clear') {
        await service.clear();
        for (const close of ports.values()) close();
        await notify();
      }
      if (parsed.data.type === 'image-cache:limit') await store.setLimit(parsed.data.bytes);
      return { ...await store.stats(), access: await allowed(), writeFailed: service.writeFailed };
    }).then(value => respond({ ok: true, value }), () => respond({ ok: false, error: 'Couldn’t update image cache. Retry.' }));
    return true;
  });
  const permissionChanged = () => { void notify().catch(() => {}); };
  chrome.permissions.onAdded.addListener(permissionChanged);
  chrome.permissions.onRemoved.addListener(permissionChanged);
}
