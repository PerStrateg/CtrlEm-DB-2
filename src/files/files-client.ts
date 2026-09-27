import { filesPort } from '../shared/files-protocol';
import { filesPolicy } from '../model/files';
import type { FilePart, FilesSnapshot, FilesGallery } from '../model/files';
import type { z } from '../shared/validation';
import type { filesRequest } from '../shared/files-protocol';
import { classifyDiagnosticError, recordDiagnostic } from '../diagnostics/session-log';

export async function filesRequestValue<T>(request: z.infer<typeof filesRequest>): Promise<T> {
  const started = performance.now();
  try {
    const reply = await chrome.runtime.sendMessage(request);
    if (!reply?.ok) throw new Error(reply?.error ?? 'Local Upload unavailable. Reload the page.');
    const galleryError = request.type === 'files:gallery' && reply.value?.error;
    if (galleryError || (request.type !== 'files:progress' && performance.now() - started > 1000) || request.type === 'files:clear' || request.type === 'files:remove') {
      recordDiagnostic('files.operation', { request: request.type, durationMs: Math.round(performance.now() - started),
        outcome: galleryError ? 'failed' : 'success', code: galleryError ? classifyDiagnosticError(new Error(galleryError)) : undefined });
    }
    return reply.value;
  } catch (error) {
    recordDiagnostic('files.operation', { request: request.type, outcome: 'failed', durationMs: Math.round(performance.now() - started), code: classifyDiagnosticError(error) });
    throw error;
  }
}
export const readFiles = () => filesRequestValue<FilesSnapshot>({ type: 'files:list' });
export const readGallery = () => filesRequestValue<FilesGallery>({ type: 'files:gallery' });

export class FilesClient {
  async get(id: string, part: FilePart, signal?: AbortSignal): Promise<Blob> {
    const port = chrome.runtime.connect({ name: filesPort });
    return new Promise((resolve, reject) => {
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
      const finish = (error?: Error, blob?: Blob) => {
        signal?.removeEventListener('abort', abort); port.onDisconnect.removeListener(disconnect); port.disconnect();
        if (error) reject(error); else resolve(blob!);
      };
      const disconnect = () => finish(new Error('File transfer interrupted.'));
      port.onDisconnect.addListener(disconnect); signal?.addEventListener('abort', abort, { once: true });
      port.onMessage.addListener(reply => {
        if (reply.error) finish(new Error(reply.error));
        else if (reply.type === 'chunk') { chunks.push(Uint8Array.from(atob(reply.data), c => c.charCodeAt(0))); port.postMessage({ type: 'ack' }); }
        else if (reply.type === 'done') finish(undefined, new Blob(chunks, { type: reply.mime }));
      });
      if (signal?.aborted) abort(); else port.postMessage({ type: 'get', id, part });
    });
  }
  async put(blob: Blob, header: { id: string; generation: string; part: FilePart; name?: string; path?: string; token?: string }): Promise<void> {
    const port = chrome.runtime.connect({ name: filesPort });
    let pending: { resolve(): void; reject(error: Error): void } | undefined;
    let closed = false;
    port.onDisconnect.addListener(() => { closed = true; pending?.reject(new Error('File transfer interrupted.')); });
    port.onMessage.addListener(reply => { reply.error ? pending?.reject(new Error(reply.error)) : pending?.resolve(); pending = undefined; });
    const send = (message: unknown) => new Promise<void>((resolve, reject) => {
      if (closed) { reject(new Error('File transfer interrupted.')); return; }
      pending = { resolve, reject }; port.postMessage(message);
    });
    try {
      await send({ type: 'put', ...header, size: blob.size, mime: blob.type });
      for (let offset = 0; offset < blob.size; offset += filesPolicy.chunkBytes) {
        // FileReader keeps the promise in the extension realm. Firefox's Xray wrapper
        // cannot await a page-owned Blob.arrayBuffer() promise (constructor access denied).
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve((reader.result as string).split(',')[1]!);
          reader.onerror = () => reject(new Error('Could not read the selected file.'));
          reader.readAsDataURL(blob.slice(offset, offset + filesPolicy.chunkBytes));
        });
        await send({ type: 'chunk', data });
      }
      await send({ type: 'finish' });
    } finally { port.disconnect(); }
  }
}
