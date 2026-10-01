import type { NativeImageService } from '../uploads/native-image-service';
import { filesPort, filesRequest, filesTransfer } from '../shared/files-protocol';
import { filesPolicy } from '../model/files';
import type { FilePart } from '../model/files';
import { authorizedTab } from './library-service';
import { FilesService } from './files-service';

export function createFilesService(images: NativeImageService): FilesService {
  const publish = (message: unknown) => {
    void chrome.tabs.query({ url: ['https://ctrlem.com/u/*', 'https://ctrlem.com/groups/*'] }).then(tabs => Promise.all(tabs.map(tab =>
      tab.id === undefined ? undefined : chrome.tabs.sendMessage(tab.id, message, { frameId: 0 }).catch(() => {}))));
  };
  return new FilesService(() => publish({ type: 'files:changed' }), snapshot => publish({ type: 'files:progress', ...snapshot }), images);
}

export function registerFiles(service: FilesService, clearQueue: () => Promise<void>, removeFile: (id: string) => Promise<void>): void {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!message?.type?.startsWith('files:')) return false;
    const tabId = authorizedTab(sender, chrome.runtime.id);
    const parsed = filesRequest.safeParse(message);
    if (tabId === undefined || !parsed.success) { respond({ ok: false, error: 'Request not allowed.' }); return false; }
    void (async () => {
      const request = parsed.data;
      if (request.type === 'files:gallery') return service.gallery();
      if (request.type === 'files:progress') return service.progressSnapshot();
      if (request.type === 'files:remove') { await removeFile(request.id); return service.repository.read(); }
      if (request.type === 'files:clear') {
        await clearQueue(); service.cancelAll(); await service.writes.run(() => service.repository.clear());
        return service.preferences({});
      }
      if (request.type === 'files:preferences') { const { type, ...change } = request; return service.preferences(change); }
      return service.repository.read();
    })().then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error instanceof Error ? error.message : 'File operation failed.' }));
    return true;
  });
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== filesPort) return;
    // Only an authorized CtrlEm tab reads or writes the collection. The processor is background-owned.
    const tabId = port.sender && authorizedTab(port.sender, chrome.runtime.id);
    if (tabId === undefined) { port.disconnect(); return; }
    const abort = new AbortController();
    let acknowledge: (() => void) | undefined;
    let header: Extract<ReturnType<typeof filesTransfer.parse>, { type: 'put' }> | undefined;
    let chunks: Uint8Array<ArrayBuffer>[] = [], size = 0, started = false;
    const send = (value: unknown) => {
      if (abort.signal.aborted) return;
      try { port.postMessage(value); } catch { abort.abort(); acknowledge?.(); }
    };
    port.onDisconnect.addListener(() => { abort.abort(); acknowledge?.(); chunks = []; });
    port.onMessage.addListener(input => {
      void (async () => {
        const message = filesTransfer.parse(input);
        if (message.type === 'ack') { acknowledge?.(); acknowledge = undefined; return; }
        if (message.type === 'get') {
          if (started) throw new Error('Invalid transfer.'); started = true;
          const blob = await service.blob(tabId, message.id, message.part, abort.signal);
          for (let offset = 0; offset < blob.size && !abort.signal.aborted; offset += filesPolicy.chunkBytes) {
            const bytes = new Uint8Array(await blob.slice(offset, offset + filesPolicy.chunkBytes).arrayBuffer());
            await new Promise<void>(resolve => { acknowledge = resolve; send({ type: 'chunk', data: bytes.toBase64() }); });
          }
          send({ type: 'done', mime: blob.type }); return;
        }
        if (message.type === 'put') {
          if (started) throw new Error('Invalid transfer.'); started = true;
          if (message.part !== 'original' || !message.name) throw new Error('File write not allowed.');
          header = message;
        } else if (message.type === 'chunk') {
          if (!header) throw new Error('Invalid transfer.');
          const bytes = Uint8Array.fromBase64(message.data); size += bytes.length;
          if (size > header.size) throw new Error('File transfer exceeds its declared size.'); chunks.push(bytes);
        } else if (message.type === 'finish') {
          if (!header || size !== header.size) throw new Error('Incomplete file transfer.');
          const h = header, blob = new Blob(chunks, { type: h.mime }); chunks = [];
          const id = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
          await service.writes.run(() => service.repository.put(h.generation, id, 'original', blob,
            { name: h.name!, path: h.path ?? h.name!, mime: h.mime, size: blob.size }));
          await service.preferences({});
        }
        send({ ok: true });
      })().catch(error => { send({ error: error instanceof Error ? error.message : 'File transfer failed.' }); });
    });
  });
}
