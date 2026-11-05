import type { HostedImageUpload } from '../ports/hosted-image-upload-port';

/** Tries hosts in order. Later slots are for imagepaste/imglink if tmper refuses. */
export class HostedImageChain implements HostedImageUpload {
  constructor(private readonly hosts: HostedImageUpload[]) {}
  async uploadImage(blob: Blob, name: string, signal: AbortSignal): Promise<string> {
    let last: unknown;
    for (const host of this.hosts) {
      try { return await host.uploadImage(blob, name, signal); }
      catch (error) {
        if (signal.aborted) throw error;
        last = error;
      }
    }
    throw last instanceof Error ? last : new Error('Couldn’t upload this image.');
  }
}
