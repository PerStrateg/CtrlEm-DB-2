import type { MediaRecipient } from '../domain/media-settings';

export interface RecipientDirectoryPort {
  list(): Promise<MediaRecipient[]>;
  search(kind: MediaRecipient['kind'], query: string): Promise<MediaRecipient[]>;
}
