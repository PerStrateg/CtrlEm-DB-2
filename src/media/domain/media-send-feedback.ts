import type { MediaAction, MediaResource } from './media-resource';
import type { MediaRecipient } from './media-settings';

export const mediaSendFeedbackMs = 2_000;
export interface MediaSendFeedback { status: 'sending' | 'sent' | 'failed'; message: string }

export function mediaSendIdentity(resource: MediaResource, action: MediaAction, recipients: MediaRecipient[]): string {
  return JSON.stringify([resource.kind, resource.url, action, recipients.map(({ receiver }) => receiver).sort()]);
}
