import { mediaRecipientsSchema, mediaSettingsChangedSchema } from '../../shared/media-settings-protocol';
import { mediaSettingsSchema, type MediaRecipient, type MediaSettings } from '../domain/media-settings';
import type { MediaSettingsPort } from '../ports/media-settings-port';

interface Reply { ok?: boolean; value?: unknown; error?: string }

export class ExtensionMediaSettingsClient implements MediaSettingsPort {
  async load(): Promise<MediaSettings> { return mediaSettingsSchema.parse(await this.request({ type: 'media-settings:get' })); }
  async save(settings: MediaSettings): Promise<MediaSettings> {
    return mediaSettingsSchema.parse(await this.request({ type: 'media-settings:save', settings }));
  }
  async recipients(): Promise<MediaRecipient[]> {
    return mediaRecipientsSchema.parse(await this.request({ type: 'media-settings:recipients' }));
  }
  subscribe(listener: (settings: MediaSettings) => void): () => void {
    const receive = (input: unknown) => {
      const parsed = mediaSettingsChangedSchema.safeParse(input);
      if (parsed.success) listener(parsed.data.settings);
    };
    chrome.runtime.onMessage.addListener(receive);
    return () => chrome.runtime.onMessage.removeListener(receive);
  }
  private async request(message: unknown): Promise<unknown> {
    const reply = await chrome.runtime.sendMessage(message) as Reply;
    if (!reply?.ok) throw new Error(reply?.error ?? 'CtrlEm is unavailable.');
    return reply.value;
  }
}
