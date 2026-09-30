import type { SendCommand } from '../../model/send-command';
import { commands } from '../../model/commands';
import { mediaCaptureRequestSchema } from '../../shared/media-send-protocol';
import { mediaCommandByAction } from '../destination';

interface NativeCommandSource { capture(key: string, validate?: boolean): SendCommand }

/** Captures the live CtrlEm command while background remains the queue owner. */
export function bindMediaCapture(page: { native: NativeCommandSource }): () => void {
  const listener = (input: unknown, sender: chrome.runtime.MessageSender, respond: (reply: unknown) => void) => {
    if ((input as { type?: string })?.type !== 'media-send:capture') return false;
    const parsed = mediaCaptureRequestSchema.safeParse(input);
    if (sender.id !== chrome.runtime.id || sender.tab || !parsed.success) { respond({ ok: false }); return false; }
    try {
      const key = mediaCommandByAction[parsed.data.action];
      const command = page.native.capture(key, false);
      const fieldId = commands[key].fieldId;
      if (!command.fields.some(field => field.id === fieldId)) throw new Error('Command field unavailable.');
      command.fields = command.fields.map(field => field.id === fieldId ? { ...field, value: parsed.data.resource.url } : field);
      respond({ ok: true, value: command });
    } catch { respond({ ok: false }); }
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
