import type { MediaRecipient, MediaSettings } from '../domain/media-settings';

export interface MediaSettingsPort {
  load(): Promise<MediaSettings>;
  save(settings: MediaSettings): Promise<MediaSettings>;
  recipients(): Promise<MediaRecipient[]>;
}
