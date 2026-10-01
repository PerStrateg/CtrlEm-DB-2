import { imageProcessorPort, type ImageProcessorNotice } from './image-processor-protocol';
import type { ImagePreparationJob } from './image-processor-protocol';
import type { ImagePreparationProgress } from '../model/files';
import { ProcessingBlobsRepository } from '../storage/processing-blobs-store';

const documentPath = 'processor-document.html';
const heartbeatMs = 20_000;
const failedError = 'Image processing stopped. Try again.';
declare const __CHROMIUM__: boolean;

/** One decoder, in an extension document in Chromium and the event page in Firefox. */
export class ProcessorHost {
  private port?: chrome.runtime.Port;
  private worker?: Worker;
  private active?: { token: string; reject(error: Error): void };
  private opening?: Promise<void>;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly blobs = new ProcessingBlobsRepository();
  private initialized?: Promise<void>;

  async run(message: ImagePreparationJob, original: Blob, signal: AbortSignal,
    progressed: (token: string, value: ImagePreparationProgress) => void): Promise<Blob> {
    const work = this.chain.then(async () => {
      signal.throwIfAborted();
      const cancel = () => this.cancel(message.token, new Error('Image preparation cancelled.'));
      signal.addEventListener('abort', cancel, { once: true });
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      try {
        if (!__CHROMIUM__) {
          const worker = this.worker = new Worker(chrome.runtime.getURL('files-worker.js'));
          const blob = await new Promise<Blob>((resolve, reject) => {
            this.active = { token: message.token, reject };
            worker.onmessage = (event: MessageEvent<{ blob: Blob; error?: string; progress?: ImagePreparationProgress }>) => {
              if (event.data.progress) progressed(message.token, event.data.progress);
              else if (event.data.error) reject(new Error(event.data.error));
              else resolve(event.data.blob);
            };
            worker.onerror = () => reject(new Error(failedError));
            worker.postMessage({ blob: original, part: message.part });
          });
          signal.throwIfAborted();
          return blob;
        }
        await (this.initialized ??= this.blobs.clear());
        await this.blobs.put(message.token, original);
        signal.throwIfAborted();
        const port = await this.connect(signal);
        this.port = port;
        signal.throwIfAborted();
        heartbeat = setInterval(() => {
          try { port.postMessage({ type: 'image-processor:heartbeat' }); }
          catch { this.cancel(message.token, new Error(failedError)); }
        }, heartbeatMs);
        await new Promise<void>((resolve, reject) => {
          this.active = { token: message.token, reject };
          port.onDisconnect.addListener(() => reject(new Error(failedError)));
          port.onMessage.addListener((notice: ImageProcessorNotice) => {
            if (notice.token !== message.token) return;
            if (notice.type === 'image-processor:progress') progressed(notice.token, notice.value);
            else if (notice.error) reject(new Error(notice.error));
            else resolve();
          });
          port.postMessage({ type: 'image-processor:run', job: message });
        });
        signal.throwIfAborted();
        const blob = await this.blobs.get(message.token);
        if (!blob) throw new Error(failedError);
        return blob;
      } finally {
        clearInterval(heartbeat);
        signal.removeEventListener('abort', cancel);
        this.active = undefined;
        this.worker?.terminate(); this.worker = undefined;
        this.port?.disconnect(); this.port = undefined;
        if (__CHROMIUM__) {
          try { if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument(); }
          catch { console.warn('[CtrlEm DB] Could not release the image processor.'); }
          await this.blobs.remove(message.token);
        }
      }
    });
    this.chain = work.catch(() => undefined).then(() => this.opening);
    return work;
  }

  private connect(signal: AbortSignal): Promise<chrome.runtime.Port> {
    if (!__CHROMIUM__) throw new Error(failedError);
    return new Promise((resolve, reject) => {
      const cleanup = () => { chrome.runtime.onConnect.removeListener(connected); signal.removeEventListener('abort', cancelled); };
      const connected = (port: chrome.runtime.Port) => {
        if (port.name !== imageProcessorPort || port.sender?.id !== chrome.runtime.id ||
          port.sender.url !== chrome.runtime.getURL(documentPath)) return;
        cleanup(); resolve(port);
      };
      const cancelled = () => { cleanup(); reject(new Error('Image preparation cancelled.')); };
      chrome.runtime.onConnect.addListener(connected);
      signal.addEventListener('abort', cancelled, { once: true });
      this.opening = chrome.offscreen.hasDocument().then(async exists => {
        if (exists) await chrome.offscreen.closeDocument();
        signal.throwIfAborted();
        await chrome.offscreen.createDocument({ url: documentPath, reasons: [chrome.offscreen.Reason.WORKERS],
          justification: 'Prepare local images without keeping a website tab open.' });
        if (signal.aborted) await chrome.offscreen.closeDocument();
      }).catch(error => { cleanup(); reject(error); }).finally(() => { this.opening = undefined; });
    });
  }

  cancel(token: string, error: Error): void {
    if (this.active?.token !== token) return;
    this.active.reject(error);
    this.worker?.terminate();
  }
}
