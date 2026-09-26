import type { ImageCacheStore } from '../storage/image-cache-store';
import { imageCacheConcurrency, imageCacheDownloadTimeoutMs } from '../model/image-cache';

interface Job {
  url: string; started: boolean; generation: number;
  consumers: Set<(blob: Blob | undefined) => void>;
  controller: AbortController;
}

/** Owns a shared bounded download queue. File lifetime on screen belongs to the view. */
export class ImageCacheService {
  private readonly jobs = new Map<string, Job>();
  private active = 0;
  private generation = 0;
  writeFailed = false;
  constructor(readonly store: ImageCacheStore, private readonly allowed: () => Promise<boolean>,
    private readonly download: typeof fetch = fetch.bind(globalThis)) {}

  acquire(url: string): { result: Promise<Blob | undefined>; release(): void } {
    let job = this.jobs.get(url);
    if (!job) {
      job = { url, started: false, generation: this.generation, consumers: new Set(), controller: new AbortController() };
      this.jobs.set(url, job);
    }
    const current = job;
    let consumer!: (blob: Blob | undefined) => void;
    const result = new Promise<Blob | undefined>(resolve => { consumer = resolve; current.consumers.add(resolve); });
    this.pump();
    return { result, release: () => {
      current.consumers.delete(consumer); consumer(undefined);
      if (!current.started && !current.consumers.size && this.jobs.get(url) === current) this.jobs.delete(url);
    } };
  }
  private pump(): void {
    for (const job of this.jobs.values()) {
      if (this.active >= imageCacheConcurrency) break;
      if (job.started) continue;
      job.started = true; this.active++;
      void this.load(job).catch(() => undefined).then(blob => {
        if (this.jobs.get(job.url) === job) this.jobs.delete(job.url);
        this.active--;
        for (const resolve of job.consumers) resolve(blob);
        this.pump();
      });
    }
  }
  private async load(job: Job): Promise<Blob | undefined> {
    let cached: Blob | undefined;
    try { cached = await this.store.get(job.url); }
    catch { this.writeFailed = true; return; }
    if (cached) return cached;
    if (!await this.allowed() || job.controller.signal.aborted) return;
    const { limit } = await this.store.stats();
    const response = await this.download(job.url, { credentials: 'omit', referrerPolicy: 'no-referrer',
      signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(imageCacheDownloadTimeoutMs)]) });
    if (!response.ok || !response.body) { await response.body?.cancel(); return; }
    const mime = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!mime.startsWith('image/') || Number(response.headers.get('content-length')) > limit) {
      await response.body.cancel(); return;
    }
    const reader = response.body.getReader();
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel(); return; }
      parts.push(value);
    }
    const blob = new Blob(parts, { type: mime });
    if (job.generation !== this.generation) return;
    try { await this.store.put(job.url, blob); this.writeFailed = false; }
    catch { this.writeFailed = true; } // A full/unavailable disk must not prevent displaying the downloaded file.
    return blob;
  }
  async clear(): Promise<void> {
    this.generation++;
    for (const job of this.jobs.values()) {
      job.controller.abort(); for (const resolve of job.consumers) resolve(undefined); job.consumers.clear();
    }
    this.jobs.clear();
    await this.store.clear(); this.writeFailed = false;
  }
}
