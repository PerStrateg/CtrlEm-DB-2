import { mediaAccessChangedSchema } from '../../shared/media-settings-protocol';
import type { MediaAccessPort } from '../ports/media-access-port';

/** Embedded Firefox documents have messaging access, not the permissions API. */
export function extensionMediaAccess(runtime: Pick<typeof chrome.runtime, 'sendMessage' | 'onMessage' | 'id'>): MediaAccessPort {
  const request = async (type: string) => {
    const reply = await runtime.sendMessage({ type });
    if (!reply?.ok) throw new Error('Couldn’t check website access.');
    return reply.value;
  };
  return {
    async granted() {
      const value = await request('media-settings:access-get');
      if (typeof value !== 'boolean') throw new Error('Invalid website access result.');
      return value;
    },
    async openSettings() { await request('media-settings:open-options'); },
    subscribe(listener) {
      const receive = (input: unknown, sender: chrome.runtime.MessageSender) => {
        const parsed = mediaAccessChangedSchema.safeParse(input);
        if (sender.id === runtime.id && !sender.tab && parsed.success) listener(parsed.data.granted);
      };
      runtime.onMessage.addListener(receive);
      return () => runtime.onMessage.removeListener(receive);
    },
  };
}
