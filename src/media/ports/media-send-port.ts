import type { MediaSendIntent } from '../domain/media-resource';
import type { MediaRecipient } from '../domain/media-settings';

export interface MediaSendPort {
  send(intent: MediaSendIntent, recipients: MediaRecipient[]): Promise<{ sent: number; failed: number }>;
}
