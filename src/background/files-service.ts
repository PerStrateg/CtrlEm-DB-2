import { filesPolicy } from '../model/files';
import type { FilePart, FileProgress, FilesGallery, FilesSnapshot, FilesProgressSnapshot, NativeUpload } from '../model/files';
import type { ImagePreparationJob } from '../files/image-processor-protocol';
import { FilesRepository } from '../storage/files-store';
import type { UploadsPort } from '../uploads/ports/uploads-port';
import { WriteQueue } from '../storage/library-store';
import { ProcessorHost } from '../files/processor-host';
import { bounded } from '../files/request-bound';
import { reportTabDiagnostic } from '../diagnostics/relay';
import { classifyDiagnosticError, diagnosticMime } from '../diagnostics/session-log';

export interface FilesSource {
  items(): Promise<{ id: string }[]>;
  prepare(tabId: number, id: string, signal: AbortSignal): Promise<void>;
  resolve(id: string, signal: AbortSignal, tabId: number): Promise<string>;
}

interface Job { id: string; part: FilePart; generation: string; abort: AbortController }

export class FilesService implements FilesSource {
  readonly repository = new FilesRepository();
  readonly writes = new WriteQueue();
  private readonly native: UploadsPort;
  private readonly processor = new ProcessorHost(
    (message, blob) => this.writes.run(() => this.repository.put(message.generation, message.id, message.part, blob)),
    (token, value) => this.processProgress(token, value));
  private readonly jobs = new Map<string, Job>();
  private readonly progress = new Map<string, { token: string; value: FileProgress }>();
  private progressRevision = Date.now();
  constructor(private readonly changed: () => void, private readonly progressChanged: (snapshot: FilesProgressSnapshot) => void,
    native: UploadsPort) { this.native = native; }
  progressSnapshot(): FilesProgressSnapshot { return { revision: this.progressRevision, items: [...this.progress.values()].map(({ value }) => value) }; }
  processProgress(token: string, progress: Omit<FileProgress, 'id' | 'stage'>): void {
    const job = this.jobs.get(token);
    if (!job || job.part !== 'prepared' || job.abort.signal.aborted) return;
    this.setProgress(job.id, token, { id: job.id, stage: 'preparing', ...progress });
  }
  private setProgress(id: string, token: string, value?: FileProgress): void {
    if (value) this.progress.set(id, { token, value });
    else if (this.progress.get(id)?.token === token) this.progress.delete(id);
    else return;
    this.progressRevision = Math.max(Date.now(), this.progressRevision + 1);
    this.progressChanged(this.progressSnapshot());
  }
  items() { return this.repository.read().then(state => state.items.map(({ id }) => ({ id }))); }
  /** Stops one preparation: its codec dies at once, other jobs keep their queued turn. */
  private cancelJob(token: string): void {
    this.jobs.get(token)?.abort.abort();
    this.processor.cancel(token, new Error('Image preparation cancelled.'));
  }
  cancelAll(): void { for (const token of [...this.jobs.keys()]) this.cancelJob(token); }
  async remove(id: string): Promise<void> {
    await this.writes.run(() => {
      for (const [token, job] of this.jobs) if (job.id === id) this.cancelJob(token);
      return this.repository.remove(id);
    });
    this.changed();
  }
  /** Reads the gallery on its own bounded request. An upload never waits behind it. */
  async gallery(): Promise<FilesGallery> {
    const request = bounded(filesPolicy.galleryReadMs);
    try {
      const uploads = await this.native.listUploads(request.signal);
      await this.writes.run(() => this.repository.update(state => {
        for (const item of state.items) if (item.uploadId && !uploads.some(upload => upload.id === item.uploadId)) delete item.uploadId;
      }));
      return { uploads };
    } catch (error) { return { uploads: [], error: error instanceof Error ? error.message : 'Could not read CtrlEm uploads.' }; }
    finally { request.dispose(); }
  }
  async blob(tabId: number, id: string, part: FilePart, signal: AbortSignal): Promise<Blob> {
    let blob = await this.repository.get(id, part);
    if (!blob && part !== 'original') { await this.process(tabId, id, part, signal); blob = await this.repository.get(id, part); }
    if (!blob) throw new Error('Local image is unavailable. Add it again.');
    return blob;
  }
  async prepare(tabId: number, id: string, signal: AbortSignal): Promise<void> {
    await this.blob(tabId, id, 'prepared', signal);
  }
  private async process(tabId: number, id: string, part: 'preview' | 'prepared', signal: AbortSignal): Promise<void> {
    const token = crypto.randomUUID(), abort = new AbortController();
    // Register while holding the same queue as deletion: it cannot miss a new job.
    const { state, item } = await this.writes.run(async () => {
      const state = await this.repository.read(), item = state.items.find(item => item.id === id);
      if (!item) throw new Error('File no longer available.');
      this.jobs.set(token, { id, part, generation: state.generation, abort });
      return { state, item };
    });
    const cancel = () => this.cancelJob(token); signal.addEventListener('abort', cancel, { once: true });
    if (part === 'prepared') this.setProgress(id, token, { id, stage: 'preparing' });
    const startedAt = performance.now();
    if (part === 'prepared') reportTabDiagnostic(tabId, 'files.prepare', { outcome: 'start', stage: 'encode', inputBytes: item.size, mime: diagnosticMime(item.mime) });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; this.cancelJob(token); }, filesPolicy.processTimeoutMs);
    try {
      if (signal.aborted) cancel();
      const original = await this.repository.get(id, 'original');
      if (!original) throw new Error('Local image is unavailable. Add it again.');
      const bytes = await this.processor.run({ token, id, part, generation: state.generation }, original, abort.signal);
      if (part === 'prepared') reportTabDiagnostic(tabId, 'files.prepare', { outcome: 'success', stage: 'encode', durationMs: performance.now() - startedAt, outputBytes: bytes });
    } catch (error) {
      const cancelled = abort.signal.aborted && !timedOut;
      if (part === 'prepared') reportTabDiagnostic(tabId, 'files.prepare', { outcome: cancelled && signal.aborted ? 'cancelled' : 'failed', stage: 'encode', durationMs: performance.now() - startedAt, code: timedOut ? 'timeout' : classifyDiagnosticError(error) });
      throw new Error(timedOut ? 'Image preparation timed out. Try a smaller image.' : cancelled ? 'Image preparation cancelled.' : error instanceof Error ? error.message : 'Image processing failed.');
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', cancel); this.jobs.delete(token);
      if (part === 'prepared') this.setProgress(id, token);
    }
  }
  /** Frees only a slot this extension owns. A full foreign gallery fails instead of deleting. */
  private async freeSlot(uploads: NativeUpload[], owned: Set<string>, signal: AbortSignal): Promise<void> {
    if (uploads.length < filesPolicy.capacity) return;
    const evictable = uploads.filter(upload => owned.has(upload.id)).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    if (!evictable.length) throw new Error('CtrlEm has no free image slot. Delete an upload, then Resume.');
    await this.native.deleteUpload(evictable[0]!.id, signal);
  }
  async resolve(id: string, signal: AbortSignal, tabId: number): Promise<string> {
    const startedAt = performance.now();
    let filename: string | undefined;
    const request = bounded(filesPolicy.uploadMs, signal);
    try {
      signal.throwIfAborted();
      const state = await this.repository.read(), item = state.items.find(item => item.id === id);
      if (!item) throw new Error('File no longer available.');
      filename = item.name;
      reportTabDiagnostic(tabId, 'files.prepare', { outcome: 'start', stage: 'upload', filename });
      const uploads = await this.native.listUploads(request.signal);
      const existing = uploads.find(upload => upload.id === item.uploadId);
      if (existing) return `https://ctrlem.com${existing.url}`;
      const blob = await this.repository.get(id, 'prepared');
      if (!blob || blob.size > filesPolicy.maxUploadBytes) throw new Error('The image has not been prepared.');
      await this.freeSlot(uploads, new Set(state.items.flatMap(file => file.uploadId ? [file.uploadId] : [])), request.signal);
      signal.throwIfAborted();
      const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1];
      const token = crypto.randomUUID();
      this.setProgress(id, token, { id, stage: 'uploading' });
      let uploaded;
      try { uploaded = await this.native.uploadImage(blob, `${item.name.replace(/\.[^.]+$/, '')}.${extension}`, request.signal); }
      finally { this.setProgress(id, token); }
      const kept = new Set(uploads.map(upload => upload.id));
      await this.writes.run(() => this.repository.update(current => {
        if (current.generation !== state.generation) return;
        const file = current.items.find(file => file.id === id); if (file) file.uploadId = uploaded.id;
        for (const file of current.items) if (file.uploadId && file.id !== id && !kept.has(file.uploadId)) delete file.uploadId;
      }));
      this.changed(); return `https://ctrlem.com${uploaded.url}`;
    } catch (error) {
      reportTabDiagnostic(tabId, 'files.prepare', { outcome: signal.aborted ? 'cancelled' : 'failed', stage: 'upload', filename, durationMs: performance.now() - startedAt, code: classifyDiagnosticError(error) });
      throw error;
    } finally { request.dispose(); }
  }
  async preferences(change: Partial<Pick<FilesSnapshot, 'previews' | 'interval' | 'selected'>>): Promise<FilesSnapshot> {
    const state = await this.writes.run(() => this.repository.update(state => {
      const { selected, ...preferences } = change;
      Object.assign(state, preferences);
      if (selected !== undefined && state.items.some(item => item.id === selected)) state.selected = selected;
      // A freshly imported collection must be sendable without an extra unexplained click.
      if (!state.selected && state.items.length) state.selected = state.items[0]!.id;
    }));
    this.changed(); return state;
  }
}
