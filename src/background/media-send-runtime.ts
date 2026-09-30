import type { AutoSendService } from './auto-send-service';
import { mediaSendRequestSchema } from '../shared/media-send-protocol';
import { mediaCommandByAction } from '../media/domain/media-command';
import { commands } from '../model/commands';
import type { MediaSettingsRepository } from '../storage/media-settings-store';
import { mediaEnabledOn, type MediaSettings } from '../media/domain/media-settings';
import type { SendCommand } from '../model/send-command';

interface MediaScheduler { enqueue(receiver: string, request: {
  type: 'auto:enqueue'; id: string; createdAt: number; parameters: SendCommand;
}): Promise<unknown> }

export async function enqueueMediaRecipients(scheduler: MediaScheduler, configuration: MediaSettings,
  parameters: SendCommand, sourceUrl: string, now = Date.now, id = crypto.randomUUID): Promise<void> {
  if (!mediaEnabledOn(configuration, sourceUrl)) throw new Error('CtrlEm is off for this site.');
  if (!configuration.selectedRecipients.length) throw new Error('Choose a CtrlEm recipient.');
  for (const recipient of configuration.selectedRecipients) await scheduler.enqueue(recipient.receiver, {
    type: 'auto:enqueue', id: id(), createdAt: now(), parameters,
  });
}

export function registerMediaSend(scheduler: AutoSendService, settings: MediaSettingsRepository): void {
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
    void settings.read().then(async configuration => {
      console.info('[CtrlEm DB][command-queue]', { event: 'enqueue', recipients: configuration.selectedRecipients.length, command: key });
      await enqueueMediaRecipients(scheduler, configuration, parameters, source.href);
    }).then(() => respond({ ok: true }), error => respond({ ok: false,
      error: error instanceof Error ? error.message : 'Couldn’t send to CtrlEm.' }));
    return true;
  });
}
