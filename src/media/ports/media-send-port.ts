import type { MediaSendIntent } from '../domain/media-resource';

export interface MediaSendPort {
  send(intent: MediaSendIntent): Promise<void>;
}
