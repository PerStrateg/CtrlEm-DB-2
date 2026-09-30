import type { AutoSendService } from './auto-send-service';
import { mediaSendRequestSchema } from '../shared/media-send-protocol';
import { mediaCommandByAction, mediaDestination } from '../media/destination';
import { commands } from '../model/commands';

export function registerMediaSend(scheduler: AutoSendService): void {
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
    console.info('[CtrlEm DB][media-api]', { event: 'enqueue', receiverKind: 'group', command: key });
    void scheduler.enqueueApi(mediaDestination.receiver, {
      type: 'auto:enqueue', id: crypto.randomUUID(), createdAt: Date.now(), parameters,
    }).then(() => respond({ ok: true }), error => respond({ ok: false,
      error: error instanceof Error ? error.message : 'Couldn’t send to CtrlEm.' }));
    return true;
  });
}
