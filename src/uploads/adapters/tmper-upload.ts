import { UploadError } from '../../shared/upload-errors';
import type { HostedImageUpload } from '../ports/hosted-image-upload-port';

export const tmperUpload = {
  endpoint: 'https://tmper.app/upload/', host: 'file.tmper.app', maxUploadBytes: 100 * 1024 * 1024,
};

/** Anonymous tmper.app POST /upload/. Verified 2026-11-05: FormData file + browser_id → JSON {success, url}. */
export class TmperUploadAdapter implements HostedImageUpload {
  readonly maxUploadBytes = tmperUpload.maxUploadBytes;
  constructor(private readonly request: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  async uploadImage(blob: Blob, name: string, signal: AbortSignal): Promise<string> {
    const body = new FormData();
    body.set('file', blob, name);
    body.set('browser_id', `browser_${crypto.randomUUID()}`);
    let response: Response;
    try { response = await this.request(tmperUpload.endpoint, { method: 'POST', body, signal, credentials: 'omit', redirect: 'error' }); }
    catch { throw new UploadError({ stage: 'upload', code: 'network' }); }
    if (!response.ok) throw new UploadError({ stage: 'upload', code: 'http', status: response.status });
    try {
      const result = await response.json();
      if (result.success !== true || typeof result.url !== 'string') throw new Error('Upload failed.');
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || url.hostname !== tmperUpload.host || url.username || url.password) {
        throw new Error('Provider did not return a direct link.');
      }
      return url.href;
    } catch (error) {
      if (error instanceof UploadError) throw error;
      throw new UploadError({ stage: 'response', code: 'invalid-response' });
    }
  }
}
