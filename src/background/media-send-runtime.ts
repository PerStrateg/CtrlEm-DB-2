import type { AutoSendService } from './auto-send-service';
import { mediaSendRequestSchema } from '../shared/media-send-protocol';
import { mediaCommandByAction } from '../media/domain/media-command';
import { commands } from '../model/commands';
import type { MediaSettingsRepository } from '../storage/media-settings-store';
import type { MediaComposerRepository } from '../storage/media-composer-store';
import { mediaEnabledOn, type MediaRecipient, type MediaSettings } from '../media/domain/media-settings';
import type { SendCommand } from '../model/send-command';

interface MediaScheduler { enqueue(receiver: string, request: {
  type: 'auto:enqueue'; id: string; createdAt: number; parameters: SendCommand;
}): Promise<unknown>; waitManual?(ids: string[]): Promise<{ sent: number; failed: number }> }

export async function enqueueMediaRecipients(scheduler: MediaScheduler, configuration: MediaSettings,
  recipients: MediaRecipient[],
  parameters: SendCommand, sourceUrl: string, now = Date.now, id = crypto.randomUUID): Promise<string[]> {
  if (!mediaEnabledOn(configuration, sourceUrl)) throw new Error('CtrlEm is off for this site.');
  if (!recipients.length) throw new Error('Choose a CtrlEm recipient.');
  const ids: string[] = [];
  for (const recipient of recipients) { const requestId = id(); ids.push(requestId); await scheduler.enqueue(recipient.receiver, {
    type: 'auto:enqueue', id: requestId, createdAt: now(), parameters,
  }); }
  return ids;
}

export function registerMediaSend(scheduler: AutoSendService, settings: MediaSettingsRepository,
  composer: MediaComposerRepository): void {
  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    if ((input as { type?: string })?.type !== 'media-send:enqueue') return false;
    const parsed = mediaSendRequestSchema.safeParse(input);
    const source = sender.url && new URL(sender.url);
    if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined || !source ||
      !['http:', 'https:'].includes(source.protocol) || !parsed.success) {
      respond({ ok: false, error: 'Request not allowed.' }); return false;
    }
    const key = mediaCommandByAction[parsed.data.action];
    const parameters = { key, label: commands[key].label,
      fields: [{ id: commands[key].fieldId, value: parsed.data.resource.url }] };
    void Promise.all([settings.read(), composer.read()]).then(async ([configuration, preferences]) => {
      console.info('[CtrlEm DB][command-queue]', { event: 'enqueue', recipients: preferences.selectedRecipients.length, command: key });
      const ids = await enqueueMediaRecipients(scheduler, configuration, preferences.selectedRecipients, parameters, source.href);
      return scheduler.waitManual(ids);
    }).then(result => respond({ ok: true, value: result }), error => respond({ ok: false,
      error: error instanceof Error ? error.message : 'Couldn’t send to CtrlEm.' }));
    return true;
  });
}
