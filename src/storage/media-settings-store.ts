import { defaultMediaSettings, mediaSettingsSchema, type MediaSettings } from '../media/domain/media-settings';
import type { StorageArea } from './library-store';
import { WriteQueue } from './library-store';

const storageKey = 'ctrlem.media-settings-v3';

export class MediaSettingsRepository {
  private readonly writes = new WriteQueue();
  constructor(private readonly storage: StorageArea) {}
  read(): Promise<MediaSettings> { return this.writes.run(() => this.readSaved()); }
  private async readSaved(): Promise<MediaSettings> {
    const value = (await this.storage.get(storageKey))[storageKey];
    if (value === undefined) return defaultMediaSettings();
    // One-time addition to the saved preferences; current requests still require the full schema.
    const saved = value as Record<string, unknown>;
    if (!Object.hasOwn(saved, 'discordOnly')) {
      const settings = mediaSettingsSchema.parse({ ...saved, discordOnly: false });
      await this.storage.set({ [storageKey]: settings }); return settings;
    }
    return mediaSettingsSchema.parse(saved);
  }
  save(settings: MediaSettings): Promise<void> {
    const value = mediaSettingsSchema.parse(settings);
    return this.writes.run(() => this.storage.set({ [storageKey]: value }));
  }
}
