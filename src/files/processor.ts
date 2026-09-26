import { FilesRepository } from '../storage/files-store';
import { FilesClient } from './files-client';
import type { FileProcess } from '../shared/files-protocol';

const store = new FilesRepository(), client = new FilesClient();
const jobs = new Map<string, { worker: Worker; cancel(): void }>();
// At most two decoders. Preparation has its own worker so a scrolling gallery cannot delay Send.
let previews = Promise.resolve();
let preparations = Promise.resolve();
const cancelled = new Set<string>();
chrome.runtime.onMessage.addListener((input, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  if (input.type === 'files:cancel-process') {
    cancelled.add(input.token); jobs.get(input.token)?.cancel(); return false;
  }
  if (input.type !== 'files:process') return false;
  const job = input as FileProcess;
  const heartbeat = setInterval(() => { void chrome.runtime.sendMessage({ type: 'files:heartbeat' }); }, 20_000);
  const run = async () => {
    if (cancelled.has(job.token)) throw new Error('Image preparation cancelled.');
    if (await store.get(job.id, job.part)) return;
    const blob = await store.get(job.id, 'original');
    if (!blob) throw new Error('Local image is unavailable.');
    if (cancelled.has(job.token)) throw new Error('Image preparation cancelled.');
    const output = await new Promise<Blob>((resolve, reject) => {
      const worker = new Worker(chrome.runtime.getURL('files-worker.js'));
      const finish = () => { worker.terminate(); jobs.delete(job.token); };
      jobs.set(job.token, { worker, cancel: () => { finish(); reject(new Error('Image preparation cancelled.')); } });
      worker.onmessage = event => { finish(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.blob); };
      worker.onerror = () => { finish(); reject(new Error('Image processing failed. Try a smaller image.')); };
      worker.postMessage({ blob, part: job.part });
    });
    if (cancelled.has(job.token)) throw new Error('Image preparation cancelled.');
    await client.put(output, { id: job.id, generation: job.generation, part: job.part, token: job.token });
  };
  const work = job.part === 'preview' ? previews.then(run) : preparations.then(run);
  if (job.part === 'preview') previews = work.catch(() => {});
  else preparations = work.catch(() => {});
  void work.then(() => respond({ ok: true }), error => respond({ ok: false, error: error.message })).finally(() => { clearInterval(heartbeat); cancelled.delete(job.token); });
  return true;
});
window.addEventListener('pagehide', () => { for (const job of jobs.values()) job.cancel(); });
