import { uploadPortName, uploadChunkBytes, uploadKeepAliveMs, uploadTimeoutMs } from '../shared/upload-protocol';
import type { UploadMessage, UploadReply } from '../shared/upload-protocol';
import type { ProviderId, UploadType } from './providers';
import type { Reply } from '../shared/library-protocol';

export interface UploadClient {
  ready(): Promise<boolean>;
  upload(provider: ProviderId, media: UploadType, file: File, signal: AbortSignal): Promise<string>;
}

export class ExtensionUploadClient implements UploadClient {
  async ready(): Promise<boolean> {
    const reply: Reply<boolean> = await chrome.runtime.sendMessage({ type: 'upload:ready' });
    if (!reply.ok) throw new Error('Couldn’t load provider settings.');
    return reply.value;
  }

  async upload(provider: ProviderId, media: UploadType, file: File, signal: AbortSignal): Promise<string> {
    const port = chrome.runtime.connect({ name: uploadPortName });
    let pending: { resolve(value: UploadReply): void; reject(error: Error): void } | undefined;
    let disconnected = false;
    const fail = () => {
      disconnected = true;
      pending?.reject(new Error('Upload interrupted. The provider may have received the file. Retry only if needed.'));
    };
    port.onDisconnect.addListener(fail);
    port.onMessage.addListener((reply: UploadReply) => { pending?.resolve(reply); pending = undefined; });
    const stop = () => { fail(); port.disconnect(); };
    signal.addEventListener('abort', stop, { once: true });
    const heartbeat = setInterval(() => { if (!disconnected) port.postMessage({ type: 'ping' }); }, uploadKeepAliveMs);
    const timeout = setTimeout(stop, uploadTimeoutMs);
    const send = async (message: UploadMessage) => {
      if (disconnected || signal.aborted) throw new Error('Upload interrupted.');
      const reply = await new Promise<UploadReply>((resolve, reject) => { pending = { resolve, reject }; port.postMessage(message); });
      if (!reply.ok) throw new Error(reply.error);
      return reply;
    };
    try {
      await send({ type: 'start', provider, media, name: file.name, mime: file.type, size: file.size });
      // Chrome runtime messages use JSON. Bounded chunks avoid its message-size limit.
      for (let offset = 0; offset < file.size; offset += uploadChunkBytes) {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]!);
          reader.onerror = () => reject(new Error('Couldn’t read file.'));
          reader.readAsDataURL(file.slice(offset, offset + uploadChunkBytes));
        });
        await send({ type: 'chunk', data });
      }
      return (await send({ type: 'finish' })).url!;
    } finally {
      clearInterval(heartbeat); clearTimeout(timeout);
      signal.removeEventListener('abort', stop);
      port.disconnect();
    }
  }
}
