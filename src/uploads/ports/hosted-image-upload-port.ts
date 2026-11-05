export interface HostedImageUpload {
  readonly maxUploadBytes: number;
  uploadImage(blob: Blob, name: string, signal: AbortSignal): Promise<string>;
}
