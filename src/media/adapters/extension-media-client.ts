import type { MediaSendIntent } from '../domain/media-resource';
import type { MediaSendPort } from '../ports/media-send-port';

export class ExtensionMediaClient implements MediaSendPort {
  async send(intent: MediaSendIntent): Promise<{ sent: number; failed: number }> {
    const reply = await chrome.runtime.sendMessage({ type: 'media-send:enqueue', ...intent });
    if (!reply?.ok) throw new Error(reply?.error ?? 'Couldn’t send to CtrlEm.');
    return reply.value;
  }
}
