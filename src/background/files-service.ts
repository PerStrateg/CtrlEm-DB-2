import { filesPolicy } from '../model/files';
import type { FilePart, FileProgress, FilesGallery, FilesSnapshot, FilesProgressSnapshot } from '../model/files';
import type { FileProcess } from '../shared/files-protocol';
import { FilesRepository } from '../storage/files-store';
import { CtrlemUploadsAdapter } from '../uploads/adapters/ctrlem-uploads';
import { WriteQueue } from '../storage/library-store';
import { reportTabDiagnostic } from '../diagnostics/relay';
import { classifyDiagnosticError, diagnosticMime } from '../diagnostics/session-log';

export interface FilesSource {
  items(): Promise<{ id: string }[]>;
  prepare(tabId: number, id: string, signal: AbortSignal): Promise<void>;
  resolve(id: string, signal: AbortSignal, tabId: number): Promise<string>;
}

export class FilesService implements FilesSource {
  readonly repository = new FilesRepository();
  readonly writes = new WriteQueue();
  private readonly uploadsQueue = new WriteQueue();
  private readonly native = new CtrlemUploadsAdapter();
  private readonly jobs = new Map<string, { tabId: number; id: string; part: FilePart; generation: string; abort: AbortController }>();
  private readonly progress = new Map<string, { token: string; value: FileProgress }>();
  private progressRevision = Date.now();
  constructor(private readonly changed: () => void, private readonly progressChanged: (snapshot: FilesProgressSnapshot) => void) {}
  progressSnapshot(): FilesProgressSnapshot { return { revision: this.progressRevision, items: [...this.progress.values()].map(({ value }) => value) }; }
  processProgress(tabId: number, token: string, progress: Omit<FileProgress, 'id' | 'stage'>): void {
    const job = this.jobs.get(token);
    if (!job || job.part !== 'prepared' || job.tabId !== tabId || job.abort.signal.aborted) return;
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
  accepts(token: string, tabId: number, id: string, part: FilePart, generation: string): boolean {
    const job = this.jobs.get(token);
    return Boolean(job && !job.abort.signal.aborted && job.tabId === tabId && job.id === id && job.part === part && job.generation === generation);
  }
  cancelAll(): void { for (const job of this.jobs.values()) job.abort.abort(); }
  async remove(id: string): Promise<void> {
    await this.writes.run(() => {
      for (const job of this.jobs.values()) if (job.id === id) job.abort.abort();
      return this.repository.remove(id);
    });
    this.changed();
  }
  gallery(): Promise<FilesGallery> {
    return this.uploadsQueue.run(async () => {
      try {
        const uploads = await this.native.listUploads();
        await this.writes.run(() => this.repository.update(state => {
          for (const item of state.items) if (item.uploadId && !uploads.some(upload => upload.id === item.uploadId)) delete item.uploadId;
        }));
        return { uploads };
      } catch (error) { return { uploads: [], error: error instanceof Error ? error.message : 'Could not read CtrlEm uploads.' }; }
    });
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
      this.jobs.set(token, { tabId, id, part, generation: state.generation, abort });
      return { state, item };
    });
    const cancel = () => abort.abort(); signal.addEventListener('abort', cancel, { once: true });
    const message: FileProcess = { type: 'files:process', token, id, part, generation: state.generation };
    if (part === 'prepared') this.setProgress(id, token, { id, stage: 'preparing' });
    const startedAt = performance.now();
    if (part === 'prepared') reportTabDiagnostic(tabId, 'files.prepare', { outcome: 'start', stage: 'encode', inputBytes: item.size, mime: diagnosticMime(item.mime) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const cancelled = new Promise<never>((_, reject) => {
      abort.signal.addEventListener('abort', () => {
        void chrome.tabs.sendMessage(tabId, { type: 'files:cancel-process', token }).catch(() => {});
        reject(new Error(timedOut ? 'Image preparation timed out. Try a smaller image.' : 'Image preparation cancelled.'));
      }, { once: true });
      timer = setTimeout(() => { timedOut = true; cancel(); }, filesPolicy.processTimeoutMs);
    });
    try {
      if (abort.signal.aborted) throw new Error('Image preparation cancelled.');
      if (signal.aborted) cancel();
      const reply = await Promise.race([chrome.tabs.sendMessage(tabId, message), cancelled]);
      if (!reply?.ok) throw new Error(reply?.error ?? 'Image processor unavailable. Reload the page.');
      if (part === 'prepared') reportTabDiagnostic(tabId, 'files.prepare', { outcome: 'success', stage: 'encode', durationMs: performance.now() - startedAt, outputBytes: reply.bytes });
    } catch (error) {
      if (part === 'prepared') reportTabDiagnostic(tabId, 'files.prepare', { outcome: timedOut ? 'failed' : abort.signal.aborted ? 'cancelled' : 'failed', stage: 'encode', durationMs: performance.now() - startedAt, code: timedOut ? 'timeout' : classifyDiagnosticError(error) });
      throw error;
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', cancel); this.jobs.delete(token);
      if (part === 'prepared') this.setProgress(id, token);
    }
  }
  resolve(id: string, signal: AbortSignal, tabId: number): Promise<string> {
    const startedAt = performance.now();
    let filename: string | undefined;
    return this.uploadsQueue.run(async () => {
      signal.throwIfAborted();
      const state = await this.repository.read(), item = state.items.find(item => item.id === id);
      if (!item) throw new Error('File no longer available.');
      filename = item.name;
      reportTabDiagnostic(tabId, 'files.prepare', { outcome: 'start', stage: 'upload', filename });
      let uploads = await this.native.listUploads(signal);
      const existing = uploads.find(upload => upload.id === item.uploadId);
      if (existing) return `https://ctrlem.com${existing.url}`;
      const blob = await this.repository.get(id, 'prepared');
      if (!blob || blob.size > filesPolicy.maxUploadBytes) throw new Error('The image has not been prepared.');
      if (uploads.length >= filesPolicy.capacity) {
        const oldest = [...uploads].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0]!;
        await this.native.deleteUpload(oldest.id, signal);
        uploads = await this.native.listUploads(signal);
        if (uploads.some(upload => upload.id === oldest.id) || uploads.length >= filesPolicy.capacity) throw new Error('CtrlEm has no free image slot. Try again.');
      }
      signal.throwIfAborted();
      const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1];
      const token = crypto.randomUUID();
      this.setProgress(id, token, { id, stage: 'uploading' });
      let uploaded;
      try { uploaded = await this.native.uploadImage(blob, `${item.name.replace(/\.[^.]+$/, '')}.${extension}`, signal); }
      finally { this.setProgress(id, token); }
      await this.writes.run(() => this.repository.update(current => {
        if (current.generation !== state.generation) return;
        const file = current.items.find(file => file.id === id); if (file) file.uploadId = uploaded.id;
        for (const file of current.items) if (file.uploadId && file.id !== id && !uploads.some(upload => upload.id === file.uploadId)) delete file.uploadId;
      }));
      this.changed(); return `https://ctrlem.com${uploaded.url}`;
    }).then(url => {
      reportTabDiagnostic(tabId, 'files.prepare', { outcome: 'success', stage: 'upload', filename, mediaUrl: url, durationMs: performance.now() - startedAt });
      return url;
    }, error => {
      reportTabDiagnostic(tabId, 'files.prepare', { outcome: signal.aborted ? 'cancelled' : 'failed', stage: 'upload', filename, durationMs: performance.now() - startedAt, code: classifyDiagnosticError(error) });
      throw error;
    });
  }
  async preferences(change: Partial<Pick<FilesSnapshot, 'previews' | 'interval' | 'selected'>>): Promise<FilesSnapshot> {
    const state = await this.writes.run(() => this.repository.update(state => {
      const { selected, ...preferences } = change;
      Object.assign(state, preferences);
      if (selected !== undefined && state.items.some(item => item.id === selected)) state.selected = selected;
    }));
    this.changed(); return state;
  }
}
