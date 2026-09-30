import type { MediaRecipient } from '../domain/media-settings';

export interface RecipientDirectoryPort {
  list(): Promise<MediaRecipient[]>;
}
