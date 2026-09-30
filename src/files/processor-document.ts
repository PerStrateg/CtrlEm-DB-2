import { FilesRepository } from '../storage/files-store';
import { imageProcessorPort, type ImageProcessorCommand, type ImageProcessorNotice } from './image-processor-protocol';
import type { ImagePreparationJob } from './image-processor-protocol';
import type { ImagePreparationProgress } from '../model/files';

const repository = new FilesRepository();
/** Cancellation kills the decoder mid-encode, so it is rebuilt lazily on the next job. */
let decoder: Worker | undefined;
const codec = () => decoder ??= new Worker(chrome.runtime.getURL('files-worker.js'));
let queue: Promise<unknown> = Promise.resolve();
const cancelled = new Set<string>();
const running = new Map<string, () => void>();

const notice = (port: chrome.runtime.Port, message: ImageProcessorNotice) => {
  try { port.postMessage(message); } catch { decoder?.terminate(); decoder = undefined; }
};

async function run(port: chrome.runtime.Port, job: ImagePreparationJob): Promise<number> {
  const original = await repository.get(job.id, 'original');
  if (!original) throw new Error('Local image is unavailable. Add it again.');
  if (cancelled.has(job.token)) throw new Error('Image preparation cancelled.');
  const worker = codec();
  const output = await new Promise<Blob>((resolve, reject) => {
    const settle = (result: () => void) => { running.delete(job.token); result(); };
    running.set(job.token, () => { worker.terminate(); decoder = undefined; settle(() => reject(new Error('Image preparation cancelled.'))); });
    worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string; progress?: ImagePreparationProgress }>) => {
      if (event.data.progress) { void notice(port, { type: 'image-processor:progress', token: job.token, value: event.data.progress }); return; }
      settle(() => event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.blob!));
    };
    worker.onerror = () => settle(() => reject(new Error('Image processing failed. Try a smaller image.')));
    worker.postMessage({ blob: original, part: job.part });
  });
  if (cancelled.has(job.token)) throw new Error('Image preparation cancelled.');
  if (job.part === 'prepared') void notice(port, { type: 'image-processor:progress', token: job.token, value: { phase: 'storing' } });
  // IndexedDB keeps generation and removal checks inside the repository transaction; no Blob crosses a port.
  await repository.put(job.generation, job.id, job.part, output);
  return output.size;
}

const port = chrome.runtime.connect({ name: imageProcessorPort });
  port.onDisconnect.addListener(() => { for (const [token, cancel] of [...running]) { cancelled.add(token); cancel(); } });
  port.onMessage.addListener((command: ImageProcessorCommand | ImageProcessorNotice) => {
    if (command.type === 'image-processor:heartbeat') return;
    if (command.type !== 'image-processor:run') {
      if (command.type === 'image-processor:cancel') { cancelled.add(command.token); running.get(command.token)?.(); }
      return;
    }
    const work = queue.then(() => run(port, command.job));
    queue = work.then(() => undefined, () => undefined);
    void work.then(bytes => notice(port, { type: 'image-processor:settled', token: command.job.token, bytes }),
      error => notice(port, { type: 'image-processor:settled', token: command.job.token, error: error instanceof Error ? error.message : 'Image processing failed.' }))
      .finally(() => cancelled.delete(command.job.token));
  });
