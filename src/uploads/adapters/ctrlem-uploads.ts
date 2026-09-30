import type { NativeUpload } from '../../model/files';
import { filesPolicy } from '../../model/files';
import { z } from '../../shared/validation';
import { bounded } from '../../files/request-bound';

const upload = z.object({ id: z.string().uuid(), originalName: z.string(), mimeType: z.string(), fileSize: z.number(),
  createdAt: z.string().datetime(), url: z.string().startsWith('/api/uploads/') });

/** Authenticated uploads; deadlines cover both headers and response bodies. */
export class CtrlemUploadsAdapter {
  constructor(private readonly request: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  private async call<T>(path: string, timeoutMs: number, read: (response: Response) => Promise<T>,
    init?: RequestInit, signal?: AbortSignal): Promise<T> {
    const bound = bounded(timeoutMs, signal);
    try {
      const response = await this.request(`https://ctrlem.com${path}`, { credentials: 'include', cache: 'no-store',
        redirect: 'error', ...init, signal: bound.signal });
      if (response.status === 429) {
        const seconds = Number(response.headers.get('retry-after'));
        throw new Error(`CtrlEm upload rate limit reached. ${seconds > 0 ? `Wait ${seconds} seconds, then Resume.` : 'Wait before resuming.'}`);
      }
      if (!response.ok) throw new Error(`CtrlEm ${init?.method ?? 'GET'} failed (${response.status}). Try again.`);
      return await read(response);
    } catch (error) {
      if (bound.signal.aborted && !signal?.aborted) throw new Error('CtrlEm did not answer in time. Try again.');
      throw error;
    } finally { bound.dispose(); }
  }
  listUploads(signal?: AbortSignal): Promise<NativeUpload[]> {
    return this.call('/api/uploads/my', filesPolicy.galleryReadMs, async response => z.array(upload).parse(await response.json()), undefined, signal);
  }
  uploadImage(blob: Blob, name: string, signal: AbortSignal): Promise<NativeUpload> {
    const body = new FormData(); body.append('image', blob, name);
    return this.call('/api/upload/image', filesPolicy.uploadMs, async response => upload.parse(await response.json()), { method: 'POST', body }, signal);
  }
  deleteUpload(id: string, signal: AbortSignal): Promise<void> {
    return this.call(`/api/uploads/${encodeURIComponent(id)}`, filesPolicy.uploadMs, async () => {}, { method: 'DELETE' }, signal);
  }
}
