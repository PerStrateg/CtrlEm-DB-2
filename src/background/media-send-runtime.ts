import type { AutoSendService } from './auto-send-service';
import type { AutoPageState } from '../shared/auto-send-protocol';
import { sendCommandSchema } from '../shared/auto-send-protocol';
import { mediaSendRequestSchema } from '../shared/media-send-protocol';
import { mediaCommandByAction, mediaDestination } from '../media/destination';
import type { MediaSendIntent } from '../media/domain/media-resource';
import { receiverUrl } from '../model/send-command';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function registerMediaSend(scheduler: AutoSendService): void {
  let opening: Promise<number> | undefined;
  const targetTab = async (): Promise<number> => {
    const url = receiverUrl(mediaDestination.receiver);
    const existing = (await chrome.tabs.query({ url })).find(tab => tab.id !== undefined);
    if (existing?.id !== undefined) return existing.id;
    opening ??= chrome.tabs.create({ url, active: false }).then(tab => {
      if (tab.id === undefined) throw new Error('Couldn’t open CtrlEm.');
      return tab.id;
    }).finally(() => { opening = undefined; });
    return opening;
  };
  const capture = async (tabId: number, intent: MediaSendIntent) => {
    const deadline = Date.now() + mediaDestination.readyTimeoutMs;
    while (Date.now() < deadline) {
      try {
        const state = await chrome.tabs.sendMessage(tabId, { type: 'auto:probe' }, { frameId: 0 }) as AutoPageState;
        const command = mediaCommandByAction[intent.action];
        if (state?.receiver === mediaDestination.receiver && state.nativeCommands.includes(command)) {
          const reply = await chrome.tabs.sendMessage(tabId, { type: 'media-send:capture', ...intent }, { frameId: 0 });
          const parsed = sendCommandSchema.safeParse(reply?.value);
          if (reply?.ok && parsed.success) return parsed.data;
        }
      } catch { /* The background tab is still loading. */ }
      await pause(mediaDestination.readinessPollMs);
    }
    throw new Error('Open CtrlEm and sign in, then retry.');
  };

  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    if ((input as { type?: string })?.type !== 'media-send:enqueue') return false;
    const parsed = mediaSendRequestSchema.safeParse(input);
    const source = sender.url && new URL(sender.url);
    if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined || !source || !['http:', 'https:'].includes(source.protocol) || !parsed.success) {
      respond({ ok: false, error: 'Request not allowed.' }); return false;
    }
    void (async () => {
      const tabId = await targetTab();
      const parameters = await capture(tabId, { resource: parsed.data.resource, action: parsed.data.action });
      await scheduler.handle(tabId, mediaDestination.receiver, {
        type: 'auto:enqueue', id: crypto.randomUUID(), createdAt: Date.now(), parameters,
      });
    })().then(() => respond({ ok: true }), error => respond({ ok: false,
      error: error instanceof Error ? error.message : 'Couldn’t send to CtrlEm.' }));
    return true;
  });
}
