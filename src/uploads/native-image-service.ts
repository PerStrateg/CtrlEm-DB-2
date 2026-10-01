import { filesPolicy, type NativeUpload } from '../model/files';
import { WriteQueue } from '../storage/library-store';
import { bounded } from '../files/request-bound';
import type { UploadsPort } from './ports/uploads-port';
import type { UploadOwnershipPort } from './ports/upload-ownership-port';
import type { PreparedImage } from './domain/prepared-image';

export const nativeUploadUrl = (upload: NativeUpload): string => new URL(upload.url, 'https://ctrlem.com').href;

/** One serialized gallery transaction for local files and website images. */
export class NativeImageService {
  private readonly queue = new WriteQueue();
  private readonly active = new Map<string, number>();
  constructor(readonly uploads: UploadsPort, private readonly ownership: UploadOwnershipPort,
    private readonly protectedSources: () => Promise<Set<string>>) {}

  async resolve(source: string, prepare: (signal: AbortSignal) => Promise<PreparedImage>, signal: AbortSignal): Promise<NativeUpload> {
    return this.queue.run(() => this.upload(source, prepare, signal));
  }
  async use<T>(source: string, prepare: (signal: AbortSignal) => Promise<PreparedImage>, signal: AbortSignal,
    send: (url: string) => Promise<T>): Promise<T> {
    const upload = await this.queue.run(async () => {
      const upload = await this.upload(source, prepare, signal);
      this.active.set(upload.id, (this.active.get(upload.id) ?? 0) + 1);
      return upload;
    });
    try { return await send(nativeUploadUrl(upload)); }
    finally {
      const count = this.active.get(upload.id)! - 1;
      if (count) this.active.set(upload.id, count); else this.active.delete(upload.id);
    }
  }
  private async upload(source: string, prepare: (signal: AbortSignal) => Promise<PreparedImage>, signal: AbortSignal): Promise<NativeUpload> {
    signal.throwIfAborted();
    const request = bounded(filesPolicy.processTimeoutMs, signal);
    try {
      const gallery = await this.uploads.listUploads(request.signal);
      request.signal.throwIfAborted();
      const present = new Set(gallery.map(upload => upload.id));
      const owned = (await this.ownership.read()).filter(record => present.has(record.uploadId));
      const cached = owned.find(record => record.source === source);
      const existing = gallery.find(upload => upload.id === cached?.uploadId);
      if (existing) return existing;
      // Prepare before eviction: a bad image must never remove a working upload.
      const image = await prepare(request.signal);
      request.signal.throwIfAborted();
      if (!image.blob.size || image.blob.size > filesPolicy.maxUploadBytes) throw new Error('This image could not fit in CtrlEm.');
      if (gallery.length >= filesPolicy.capacity) {
        const protectedSources = await this.protectedSources();
        const eligible = new Set(owned.filter(record => !protectedSources.has(record.source)).map(record => record.uploadId));
        const oldest = gallery.filter(upload => eligible.has(upload.id) && !this.active.has(upload.id) && !protectedSources.has(nativeUploadUrl(upload)))
          .reduce<NativeUpload | undefined>((oldest, upload) => !oldest || Date.parse(upload.createdAt) < Date.parse(oldest.createdAt) ? upload : oldest, undefined);
        if (!oldest) throw new Error('CtrlEm image storage is full. Free a slot or finish queued sends.');
        await this.uploads.deleteUpload(oldest.id, request.signal);
        owned.splice(owned.findIndex(record => record.uploadId === oldest.id), 1);
        await this.ownership.save(owned);
      }
      const uploaded = await this.uploads.uploadImage(image.blob, image.name, request.signal);
      await this.ownership.save([...owned.filter(record => record.source !== source), { source, uploadId: uploaded.id }]);
      return uploaded;
    } finally { request.dispose(); }
  }
}
