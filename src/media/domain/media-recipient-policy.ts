import type { MediaRecipient } from './media-settings';
import type { MediaAction } from './media-resource';

/** CtrlEm accepts video overlay only on personal control codes, not group command endpoints. */
export function mediaActionBlockedReason(action: MediaAction, recipients: readonly MediaRecipient[]): string | undefined {
  if (!recipients.length) return undefined;
  if (action === 'video-overlay' && recipients.some(recipient => recipient.kind === 'group')) {
    return 'Video overlay sends to people only, not groups.';
  }
  return undefined;
}
