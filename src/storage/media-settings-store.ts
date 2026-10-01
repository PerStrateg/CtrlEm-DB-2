import { defaultMediaSettings, mediaSettingsSchema, type MediaSettings } from '../media/domain/media-settings';
import type { StorageArea } from './library-store';

const storageKey = 'ctrlem.media-settings-v3';

export class MediaSettingsRepository {
  constructor(private readonly storage: StorageArea) {}
  async read(): Promise<MediaSettings> {
    const value = (await this.storage.get(storageKey))[storageKey];
    return value === undefined ? defaultMediaSettings() : mediaSettingsSchema.parse(value);
  }
  save(settings: MediaSettings): Promise<void> { return this.storage.set({ [storageKey]: mediaSettingsSchema.parse(settings) }); }
}
