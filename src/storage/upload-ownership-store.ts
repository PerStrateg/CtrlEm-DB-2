import { z } from '../shared/validation';
import type { StorageArea } from './library-store';
import type { OwnedUpload, UploadOwnershipPort } from '../uploads/ports/upload-ownership-port';

const key = 'ctrlem.upload-ownership';
const schema = z.array(z.object({ source: z.string().min(1), uploadId: z.string().uuid() }).strict());
export class UploadOwnershipRepository implements UploadOwnershipPort {
  constructor(private readonly storage: StorageArea) {}
  async read(): Promise<OwnedUpload[]> {
    const saved = (await this.storage.get(key))[key];
    return saved === undefined ? [] : schema.parse(saved);
  }
  save(uploads: OwnedUpload[]): Promise<void> { return this.storage.set({ [key]: schema.parse(uploads) }); }
}
