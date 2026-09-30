import type { AutoSendService } from './auto-send-service';
import { mediaSendRequestSchema } from '../shared/media-send-protocol';
import { mediaCommandByAction } from '../media/domain/media-command';
import { commands } from '../model/commands';
import type { MediaSettingsRepository } from '../storage/media-settings-store';
import { mediaEnabledOn, type MediaRecipient, type MediaSettings } from '../media/domain/media-settings';
import type { SendCommand } from '../model/send-command';

interface MediaScheduler { enqueueBatch(requests: { receiver: string; request: {
  type: 'auto:enqueue'; id: string; createdAt: number; parameters: SendCommand;
} }[]): Promise<{ sent: number; failed: number }> }

export async function enqueueMediaRecipients(scheduler: MediaScheduler, configuration: MediaSettings,
  recipients: MediaRecipient[],
  parameters: SendCommand, sourceUrl: string, now = Date.now, id = () => crypto.randomUUID()): Promise<{ sent: number; failed: number }> {
  if (!mediaEnabledOn(configuration, sourceUrl)) throw new Error('CtrlEm is off for this site.');
  if (!recipients.length) throw new Error('Choose a CtrlEm recipient.');
  const requests = recipients.map(recipient => ({ receiver: recipient.receiver,
    request: { type: 'auto:enqueue' as const, id: id(), createdAt: now(), parameters } }));
  return scheduler.enqueueBatch(requests);
}

export function registerMediaSend(scheduler: AutoSendService, settings: MediaSettingsRepository): void {
  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    if ((input as { type?: string })?.type !== 'media-send:enqueue') return false;
    const parsed = mediaSendRequestSchema.safeParse(input);
    const source = sender.url && URL.canParse(sender.url) ? new URL(sender.url) : undefined;
    if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined || !source ||
      !['http:', 'https:'].includes(source.protocol) || !parsed.success) {
      respond({ ok: false, error: 'Request not allowed.' }); return false;
    }
    const key = mediaCommandByAction[parsed.data.action];
    const parameters = { key, label: commands[key].label,
      fields: [{ id: commands[key].fieldId, value: parsed.data.resource.url }] };
    void settings.read().then(async configuration => {
      return enqueueMediaRecipients(scheduler, configuration, parsed.data.recipients, parameters, source.href);
    }).then(result => respond({ ok: true, value: result }), error => respond({ ok: false,
      error: error instanceof Error ? error.message : 'Couldn’t send to CtrlEm.' }));
    return true;
  });
}
