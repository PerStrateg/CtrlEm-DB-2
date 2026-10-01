import type { PreparedImage } from '../../uploads/domain/prepared-image';
import type { MediaResource } from '../domain/media-resource';

export interface ImageDeliveryPort {
  use<T>(source: string, prepare: (signal: AbortSignal) => Promise<PreparedImage>, signal: AbortSignal,
    send: (url: string) => Promise<T>): Promise<T>;
}
export interface MediaPreparationPort {
  download(resource: MediaResource, signal: AbortSignal): Promise<File>;
  prepare(blob: Blob, signal: AbortSignal): Promise<Blob>;
}
