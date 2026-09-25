import { uploadMessage } from '../shared/upload-protocol';
import type { UploadMessage, UploadReply } from '../shared/upload-protocol';
import { uploadFile, uploadFileError } from '../upload/providers';
import type { CredentialsRepository } from '../storage/credentials-store';

/** One port owns one file. Disconnection releases the bytes and aborts its request. */
export class UploadSession {
  private metadata?: Extract<UploadMessage, { type: 'start' }>;
  private parts: Uint8Array<ArrayBuffer>[] = [];
  private received = 0;
  private uploading = false;
  private closed = false;
  private readonly abort = new AbortController();
  constructor(private readonly credentials: CredentialsRepository, private readonly request: typeof fetch = fetch) {}

  async handle(input: unknown): Promise<UploadReply | undefined> {
    try {
      const message = uploadMessage.parse(input);
      if (message.type === 'ping') return;
      if (this.closed || this.uploading) throw new Error('Upload is no longer accepting data.');
      if (message.type === 'start') {
        if (this.metadata) throw new Error('Already started.');
        const error = uploadFileError(message.provider, message.media, { name: message.name, type: message.mime, size: message.size });
        if (error) return { ok: false, error };
        this.metadata = message;
      } else if (message.type === 'chunk') {
        if (!this.metadata) throw new Error('Missing file.');
        const bytes = Uint8Array.from(atob(message.data), char => char.charCodeAt(0));
        this.received += bytes.length;
        if (this.received > this.metadata.size) throw new Error('File exceeds declared size.');
        this.parts.push(bytes);
      } else {
        if (!this.metadata || this.received !== this.metadata.size) throw new Error('Incomplete file.');
        this.uploading = true;
        const file = new File(this.parts, this.metadata.name, { type: this.metadata.mime });
        this.parts = [];
        const credentials = await this.credentials.read();
        const url = await uploadFile(this.metadata.provider, file, credentials, this.abort.signal, this.request);
        this.closed = true;
        return { ok: true, url };
      }
      return { ok: true };
    } catch {
      this.close();
      return { ok: false, error: 'Couldn’t upload this file. Check provider settings and connection, then Retry. The provider may have received it.' };
    }
  }
  close(): void { this.closed = true; this.parts = []; this.abort.abort(); }
}
