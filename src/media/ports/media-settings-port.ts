import type { MediaRecipient, MediaSettings } from '../domain/media-settings';
import type { MediaComposerPreferences } from '../domain/media-composer';

export interface MediaSettingsPort {
  load(): Promise<MediaSettings>;
  save(settings: MediaSettings): Promise<MediaSettings>;
  loadComposer(): Promise<MediaComposerPreferences>;
  saveComposer(preferences: MediaComposerPreferences): Promise<MediaComposerPreferences>;
  recipients(kind: MediaRecipient['kind'], query: string): Promise<MediaRecipient[]>;
}
