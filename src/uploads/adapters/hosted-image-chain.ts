import type { HostedImageUpload } from '../ports/hosted-image-upload-port';

/** Tries hosts in order. Later slots are for imagepaste/imglink if tmper refuses. */
export class HostedImageChain implements HostedImageUpload {
  readonly maxUploadBytes: number;
  constructor(private readonly hosts: HostedImageUpload[]) {
    if (!hosts.length) throw new Error('Hosted image chain needs at least one host.');
    this.maxUploadBytes = Math.max(...hosts.map(host => host.maxUploadBytes));
  }
  async uploadImage(blob: Blob, name: string, signal: AbortSignal): Promise<string> {
    if (blob.size > this.maxUploadBytes) throw new Error('This image could not fit the upload limit.');
    let last: unknown;
    for (const host of this.hosts) {
      if (blob.size > host.maxUploadBytes) continue;
      try { return await host.uploadImage(blob, name, signal); }
      catch (error) {
        if (signal.aborted) throw error;
        last = error;
      }
    }
    throw last instanceof Error ? last : new Error('Couldn’t upload this image.');
  }
}
