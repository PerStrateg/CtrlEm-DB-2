import { filesPolicy } from '../model/files';
import type { FilePart, FilesGallery, FilesSnapshot } from '../model/files';
import type { FileProcess } from '../shared/files-protocol';
import { FilesRepository } from '../storage/files-store';
import { NativeUploads } from '../site/native-uploads';
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
  private readonly native = new NativeUploads();
  private readonly jobs = new Map<string, { tabId: number; id: string; part: FilePart; generation: string; abort: AbortController }>();
  constructor(private readonly changed: () => void) {}
  items() { return this.repository.read().then(state => state.items.map(({ id }) => ({ id }))); }
  accepts(token: string, tabId: number, id: string, part: FilePart, generation: string): boolean {
    const job = this.jobs.get(token);
    return Boolean(job && !job.abort.signal.aborted && job.tabId === tabId && job.id === id && job.part === part && job.generation === generation);
  }
  cancelAll(): void { for (const job of this.jobs.values()) job.abort.abort(); }
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
    const state = await this.repository.read();
    const item = state.items.find(item => item.id === id);
    if (!item) throw new Error('File no longer available.');
    const token = crypto.randomUUID(), abort = new AbortController();
    const cancel = () => abort.abort(); signal.addEventListener('abort', cancel, { once: true });
    const message: FileProcess = { type: 'files:process', token, id, part, generation: state.generation };
    this.jobs.set(token, { tabId, id, part, generation: state.generation, abort });
    const startedAt = performance.now();
    if (part === 'prepared') reportTabDiagnostic(tabId, 'files.prepare', { outcome: 'start', stage: 'encode', inputBytes: item.size, mime: diagnosticMime(item.mime) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      abort.signal.addEventListener('abort', () => {
        void chrome.tabs.sendMessage(tabId, { type: 'files:cancel-process', token }).catch(() => {});
        reject(new Error('Image preparation cancelled.'));
      }, { once: true });
      timer = setTimeout(cancel, filesPolicy.processTimeoutMs);
    });
    try {
      if (signal.aborted) cancel();
      const reply = await Promise.race([chrome.tabs.sendMessage(tabId, message), cancelled]);
      if (!reply?.ok) throw new Error(reply?.error ?? 'Image processor unavailable. Reload the page.');
      if (part === 'prepared') reportTabDiagnostic(tabId, 'files.prepare', { outcome: 'success', stage: 'encode', durationMs: performance.now() - startedAt, outputBytes: reply.bytes });
    } catch (error) {
      if (part === 'prepared') reportTabDiagnostic(tabId, 'files.prepare', { outcome: abort.signal.aborted ? 'cancelled' : 'failed', stage: 'encode', durationMs: performance.now() - startedAt, code: classifyDiagnosticError(error) });
      throw error;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); this.jobs.delete(token); }
  }
  resolve(id: string, signal: AbortSignal, tabId: number): Promise<string> {
    const startedAt = performance.now();
    reportTabDiagnostic(tabId, 'files.prepare', { outcome: 'start', stage: 'upload' });
    return this.uploadsQueue.run(async () => {
      signal.throwIfAborted();
      const state = await this.repository.read(), item = state.items.find(item => item.id === id);
      if (!item) throw new Error('File no longer available.');
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
      const uploaded = await this.native.uploadImage(blob, `${item.name.replace(/\.[^.]+$/, '')}.${extension}`, signal);
      await this.writes.run(() => this.repository.update(current => {
        if (current.generation !== state.generation) return;
        const file = current.items.find(file => file.id === id); if (file) file.uploadId = uploaded.id;
        for (const file of current.items) if (file.uploadId && file.id !== id && !uploads.some(upload => upload.id === file.uploadId)) delete file.uploadId;
      }));
      this.changed(); return `https://ctrlem.com${uploaded.url}`;
    }).then(url => {
      reportTabDiagnostic(tabId, 'files.prepare', { outcome: 'success', stage: 'upload', durationMs: performance.now() - startedAt });
      return url;
    }, error => {
      reportTabDiagnostic(tabId, 'files.prepare', { outcome: signal.aborted ? 'cancelled' : 'failed', stage: 'upload', durationMs: performance.now() - startedAt, code: classifyDiagnosticError(error) });
      throw error;
    });
  }
  async preferences(change: Partial<Pick<FilesSnapshot, 'previews' | 'interval' | 'selected'>>): Promise<FilesSnapshot> {
    const state = await this.writes.run(() => this.repository.update(state => Object.assign(state, change)));
    this.changed(); return state;
  }
}
