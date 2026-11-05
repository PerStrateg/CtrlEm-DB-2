export interface HostedImageUpload {
  uploadImage(blob: Blob, name: string, signal: AbortSignal): Promise<string>;
}
