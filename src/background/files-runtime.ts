import { filesPort, filesRequest, filesTransfer, filesProcessProgress } from '../shared/files-protocol';
import { filesPolicy } from '../model/files';
import type { FilePart } from '../model/files';
import { authorizedTab } from './library-service';
import { FilesService } from './files-service';

function fileSender(sender: chrome.runtime.MessageSender): { tabId: number; processor: boolean } | undefined {
  const tabId = authorizedTab(sender, chrome.runtime.id);
  if (tabId !== undefined) return { tabId, processor: false };
  if (sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('files-processor.html') && sender.tab?.id !== undefined &&
    /^https:\/\/ctrlem\.com\/(u|groups)\//.test(sender.tab.url ?? '')) return { tabId: sender.tab.id, processor: true };
}

export function createFilesService(): FilesService {
  const publish = (message: unknown) => {
    void chrome.tabs.query({ url: ['https://ctrlem.com/u/*', 'https://ctrlem.com/groups/*'] }).then(tabs => Promise.all(tabs.map(tab =>
      tab.id === undefined ? undefined : chrome.tabs.sendMessage(tab.id, message, { frameId: 0 }).catch(() => {}))));
  };
  return new FilesService(() => publish({ type: 'files:changed' }), snapshot => publish({ type: 'files:progress', ...snapshot }));
}

export function registerFiles(service: FilesService, clearQueue: () => Promise<void>): void {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!message?.type?.startsWith('files:')) return false;
    if (message.type === 'files:heartbeat' && fileSender(sender)?.processor) { respond({ ok: true }); return false; }
    const source = fileSender(sender), parsed = filesRequest.safeParse(message);
    if (message.type === 'files:process-progress') {
      const progress = filesProcessProgress.safeParse(message);
      if (source?.processor && progress.success) {
        const { type, token, ...value } = progress.data;
        service.processProgress(source.tabId, token, value);
      }
      return false;
    }
    if (!source || source.processor || !parsed.success) { respond({ ok: false, error: 'Request not allowed.' }); return false; }
    void (async () => {
      const request = parsed.data;
      if (request.type === 'files:gallery') return service.gallery();
      if (request.type === 'files:progress') return service.progressSnapshot();
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
    const source = port.sender && fileSender(port.sender);
    if (!source) { port.disconnect(); return; }
    const abort = new AbortController();
    let acknowledge: (() => void) | undefined;
    let header: Extract<ReturnType<typeof filesTransfer.parse>, { type: 'put' }> | undefined;
    let chunks: Uint8Array<ArrayBuffer>[] = [], size = 0, started = false;
    const send = (value: unknown) => { if (!abort.signal.aborted) port.postMessage(value); };
    port.onDisconnect.addListener(() => { abort.abort(); acknowledge?.(); chunks = []; });
    port.onMessage.addListener(input => {
      void (async () => {
        const message = filesTransfer.parse(input);
        if (message.type === 'ack') { acknowledge?.(); acknowledge = undefined; return; }
        if (message.type === 'get') {
          if (started || source.processor) throw new Error('Invalid transfer.'); started = true;
          const blob = await service.blob(source.tabId, message.id, message.part, abort.signal);
          for (let offset = 0; offset < blob.size && !abort.signal.aborted; offset += filesPolicy.chunkBytes) {
            const bytes = new Uint8Array(await blob.slice(offset, offset + filesPolicy.chunkBytes).arrayBuffer());
            let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            await new Promise<void>(resolve => { acknowledge = resolve; send({ type: 'chunk', data: btoa(binary) }); });
          }
          send({ type: 'done', mime: blob.type }); return;
        }
        if (message.type === 'put') {
          if (started) throw new Error('Invalid transfer.'); started = true;
          if (source.processor ? !message.token || !service.accepts(message.token, source.tabId, message.id, message.part, message.generation)
            : message.part !== 'original' || !message.name) throw new Error('File write not allowed.');
          header = message;
        } else if (message.type === 'chunk') {
          if (!header) throw new Error('Invalid transfer.');
          const bytes = Uint8Array.from(atob(message.data), c => c.charCodeAt(0)); size += bytes.length;
          if (size > header.size) throw new Error('File transfer exceeds its declared size.'); chunks.push(bytes);
        } else if (message.type === 'finish') {
          if (!header || size !== header.size) throw new Error('Incomplete file transfer.');
          const h = header, blob = new Blob(chunks, { type: h.mime }); chunks = [];
          if (source.processor && !service.accepts(h.token!, source.tabId, h.id, h.part, h.generation)) throw new Error('Image preparation cancelled.');
          const id = h.part === 'original' ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('') : h.id;
          await service.writes.run(() => service.repository.put(h.generation, id, h.part as FilePart, blob,
            { name: h.name!, path: h.path ?? h.name!, mime: h.mime, size: blob.size }));
          if (h.part === 'original') await service.preferences({});
        }
        send({ ok: true });
      })().catch(error => { send({ error: error instanceof Error ? error.message : 'File transfer failed.' }); });
    });
  });
}
