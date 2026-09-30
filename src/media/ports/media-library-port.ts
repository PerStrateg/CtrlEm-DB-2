import type { MediaKind } from '../domain/media-resource';
export interface MediaCategory { id: string; name: string }
export interface MediaLibraryProgress { stage: 'download' | 'upload' | 'save'; loaded?: number; total?: number }
export interface MediaLibraryPort {
  categories(kind: MediaKind): Promise<MediaCategory[]>;
  save(resourceUrl: string, kind: MediaKind, categoryId: string, progress: (value: MediaLibraryProgress) => void): Promise<void>;
}
