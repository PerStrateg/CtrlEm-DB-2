import { UploadError } from '../shared/upload-errors';
import { uploadPortName, uploadChunkBytes, uploadKeepAliveMs, uploadTimeoutMs } from '../shared/upload-protocol';
import type { UploadMessage, UploadReply } from '../shared/upload-protocol';
import type { ProviderId, UploadType } from './providers';
import type { Reply } from '../shared/library-protocol';
import { classifyDiagnosticError, diagnosticBrowserError, diagnosticMime, recordDiagnostic } from '../diagnostics/session-log';

export interface UploadClient {
  catboxAllowed?(): Promise<boolean>;
  openAccessSettings?(): Promise<void>;
  ready(): Promise<boolean>;
  subscribeSettings?(listener: () => void): () => void;
  upload(provider: ProviderId, media: UploadType, file: File, signal: AbortSignal): Promise<string>;
}

export class ExtensionUploadClient implements UploadClient {
  async openAccessSettings(): Promise<void> {
    const reply: Reply<void> = await chrome.runtime.sendMessage({ type: 'settings:open' });
    if (!reply.ok) throw new Error('Couldn’t open provider settings.');
  }
  async catboxAllowed(): Promise<boolean> {
    const reply: Reply<boolean> = await chrome.runtime.sendMessage({ type: 'upload:catbox-access' });
    if (!reply.ok) throw new Error('Couldn’t check Catbox access.');
    return reply.value;
  }
  subscribeSettings(listener: () => void): () => void {
    const onChange = (message: { type?: string }) => { if (message.type === 'upload:settings-changed') listener(); };
    chrome.runtime.onMessage.addListener(onChange);
    return () => chrome.runtime.onMessage.removeListener(onChange);
  }

  async ready(): Promise<boolean> {
    const reply: Reply<boolean> = await chrome.runtime.sendMessage({ type: 'upload:ready' });
    if (!reply.ok) throw new Error('Couldn’t load provider settings.');
    return reply.value;
  }

  async upload(provider: ProviderId, media: UploadType, file: File, signal: AbortSignal): Promise<string> {
    const started = performance.now();
    const diagnostic = { provider, bytes: file.size, mime: diagnosticMime(file.type), filename: file.name };
    recordDiagnostic('upload', { ...diagnostic, outcome: 'start' });
    const port = chrome.runtime.connect({ name: uploadPortName });
    let pending: { resolve(value: UploadReply): void; reject(error: Error): void } | undefined;
    let disconnected = false;
    const fail = () => {
      disconnected = true;
      pending?.reject(new UploadError({ stage: 'transfer', code: 'interrupted' }));
    };
    port.onDisconnect.addListener(fail);
    port.onMessage.addListener((reply: UploadReply) => { pending?.resolve(reply); pending = undefined; });
    const stop = () => { fail(); port.disconnect(); };
    signal.addEventListener('abort', stop, { once: true });
    const heartbeat = setInterval(() => { if (!disconnected) port.postMessage({ type: 'ping' }); }, uploadKeepAliveMs);
    const timeout = setTimeout(stop, uploadTimeoutMs);
    const send = async (message: UploadMessage) => {
      if (disconnected || signal.aborted) throw new UploadError({ stage: 'transfer', code: 'interrupted' });
      const reply = await new Promise<UploadReply>((resolve, reject) => { pending = { resolve, reject }; port.postMessage(message); });
      if (!reply.ok) throw reply.failure ? new UploadError(reply.failure) : new Error(reply.error);
      return reply;
    };
    try {
      await send({ type: 'start', provider, media, name: file.name, mime: file.type, size: file.size });
      // Chrome runtime messages use JSON. Bounded chunks avoid its message-size limit.
      for (let offset = 0; offset < file.size; offset += uploadChunkBytes) {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]!);
          reader.onerror = () => reject(new UploadError({ stage: 'transfer', code: 'file-read' }));
          reader.readAsDataURL(file.slice(offset, offset + uploadChunkBytes));
        });
        await send({ type: 'chunk', data });
      }
      const url = (await send({ type: 'finish' })).url!;
      recordDiagnostic('upload', { ...diagnostic, outcome: 'success', mediaUrl: url, durationMs: Math.round(performance.now() - started) });
      return url;
    } catch (error) {
      const failure = error instanceof UploadError ? error.failure : undefined;
      recordDiagnostic('upload', { ...diagnostic, outcome: signal.aborted ? 'cancelled' : 'failed',
        durationMs: Math.round(performance.now() - started), code: failure?.code ?? classifyDiagnosticError(error),
        stage: failure?.stage, status: failure?.status ?? failure?.network?.status, anonymous: failure?.anonymous,
        observation: failure?.network?.observation, hostPermission: failure?.network?.hostPermission,
        observerPermission: failure?.network?.observerPermission, redirected: failure?.network?.redirected,
        originMissing: failure?.network?.originMissing, browserError: diagnosticBrowserError(failure?.network?.browserError) });
      throw error;
    } finally {
      clearInterval(heartbeat); clearTimeout(timeout);
      signal.removeEventListener('abort', stop);
      port.disconnect();
    }
  }
}
