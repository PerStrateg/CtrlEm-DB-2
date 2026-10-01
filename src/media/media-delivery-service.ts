import { imageDelivery } from './domain/media-delivery';
import type { MediaResource } from './domain/media-resource';
import type { ImageDeliveryPort, MediaPreparationPort } from './ports/media-delivery-port';

export class MediaDeliveryService {
  constructor(private readonly images: ImageDeliveryPort, private readonly preparation: MediaPreparationPort) {}
  async send<T>(resource: MediaResource, send: (url: string) => Promise<T>): Promise<T> {
    if (imageDelivery(resource.kind, new URL(resource.url)) === 'direct') return send(resource.url);
    const signal = new AbortController().signal;
    return this.images.use(resource.url, async signal => {
      const file = await this.preparation.download(resource, signal).catch(error => {
        const code = error instanceof Error ? error.message : '';
        throw new Error(code === 'size' ? 'This image is too large.' : 'Couldn’t read this image. Try a direct image link.');
      });
      const blob = await this.preparation.prepare(file, signal).catch(() => { throw new Error('Couldn’t prepare this image. Try another file.'); });
      const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1];
      return { blob, name: `${file.name.replace(/\.[^.]+$/, '')}.${extension}` };
    }, signal, send);
  }
}
