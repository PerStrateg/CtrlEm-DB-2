import type { NativeUpload } from '../model/files';
import { z } from '../shared/validation';

const upload = z.object({ id: z.string().uuid(), originalName: z.string(), mimeType: z.string(), fileSize: z.number(),
  createdAt: z.string().datetime(), url: z.string().startsWith('/api/uploads/') });

/** The same authenticated endpoints used by CtrlEm's native image picker. */
export class NativeUploads {
  constructor(private readonly request: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  private async call(path: string, init?: RequestInit): Promise<Response> {
    const response = await this.request(`https://ctrlem.com${path}`, { credentials: 'include', cache: 'no-store', ...init });
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      throw new Error(`CtrlEm upload rate limit reached. ${seconds > 0 ? `Wait ${seconds} seconds, then Resume.` : 'Wait before resuming.'}`);
    }
    if (!response.ok) throw new Error(`CtrlEm ${init?.method ?? 'GET'} failed (${response.status}). Try again.`);
    return response;
  }
  async listUploads(signal?: AbortSignal): Promise<NativeUpload[]> {
    return z.array(upload).parse(await (await this.call('/api/uploads/my', { signal })).json());
  }
  async uploadImage(blob: Blob, name: string, signal: AbortSignal): Promise<NativeUpload> {
    const body = new FormData(); body.append('image', blob, name);
    return upload.parse(await (await this.call('/api/upload/image', { method: 'POST', body, signal })).json());
  }
  async deleteUpload(id: string, signal: AbortSignal): Promise<void> {
    await this.call(`/api/uploads/${encodeURIComponent(id)}`, { method: 'DELETE', signal });
  }
}
