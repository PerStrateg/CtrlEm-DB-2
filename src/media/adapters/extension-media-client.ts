import type { MediaSendIntent } from '../domain/media-resource';
import type { MediaSendPort } from '../ports/media-send-port';
import type { MediaRecipient } from '../domain/media-settings';

export class ExtensionMediaClient implements MediaSendPort {
  async send(intent: MediaSendIntent, recipients: MediaRecipient[]): Promise<{ sent: number; failed: number }> {
    const reply = await chrome.runtime.sendMessage({ type: 'media-send:enqueue', ...intent, recipients });
    if (!reply?.ok) throw new Error(reply?.error ?? 'Couldn’t send to CtrlEm.');
    return reply.value;
  }
}
