import type { NativeUpload } from '../../model/files';

export interface UploadsPort {
  listUploads(signal?: AbortSignal): Promise<NativeUpload[]>;
  uploadImage(blob: Blob, name: string, signal: AbortSignal): Promise<NativeUpload>;
  deleteUpload(id: string, signal: AbortSignal): Promise<void>;
}
