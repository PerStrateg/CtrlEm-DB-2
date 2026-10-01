export interface OwnedUpload { source: string; uploadId: string }
export interface UploadOwnershipPort {
  read(): Promise<OwnedUpload[]>;
  save(uploads: OwnedUpload[]): Promise<void>;
}
