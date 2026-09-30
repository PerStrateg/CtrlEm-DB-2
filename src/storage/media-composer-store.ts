import { defaultMediaComposerPreferences, mediaComposerPreferencesSchema, type MediaComposerPreferences } from '../media/domain/media-composer';
import type { StorageArea } from './library-store';

const storageKey = 'ctrlem.media-composer';

export class MediaComposerRepository {
  constructor(private readonly storage: StorageArea) {}
  async read(): Promise<MediaComposerPreferences> {
    const value = (await this.storage.get(storageKey))[storageKey];
    return value === undefined ? defaultMediaComposerPreferences() : mediaComposerPreferencesSchema.parse(value);
  }
  save(value: MediaComposerPreferences): Promise<void> {
    return this.storage.set({ [storageKey]: mediaComposerPreferencesSchema.parse(value) });
  }
}
