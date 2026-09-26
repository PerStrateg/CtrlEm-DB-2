import { redgifsRequest } from '../redgifs/messaging';
import { installEmbedSessionBridges } from '../redgifs/cookie-partition';
import { receiverFromUrl } from '../model/send-command';
import { WriteQueue } from '../storage/library-store';
import { normalizeSession, REDGIFS_SESSION_KEY } from '../redgifs/redgifs-overlay';

export function registerRedgifs(): void {
  const sessionQueue = new WriteQueue();
  installEmbedSessionBridges();
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!(message as { type?: string })?.type?.startsWith('redgifs:')) return false;
    const parsed = redgifsRequest.safeParse(message);
    const frame = Boolean(sender.frameId) && /^https:\/\/([a-z0-9-]+\.)?redgifs\.com\//i.test(sender.url ?? '');
    const parent = sender.frameId === 0 && /^https:\/\/ctrlem.com\/(u|groups)\//.test(sender.url ?? '');
    const allowed = sender.id === chrome.runtime.id && sender.tab?.id !== undefined &&
      (frame || (parent && parsed.success && parsed.data.type === 'redgifs:session-load'));
    if (!allowed || !parsed.success) { respond({ ok: false, error: 'Request not allowed.' }); return false; }
    void (async () => {
      const tab = await chrome.tabs.get(sender.tab!.id!);
      if (!tab.url || !receiverFromUrl(tab.url)) throw new Error('CtrlEm page is unavailable.');
      if (parsed.data.type === 'redgifs:session-load' || parsed.data.type === 'redgifs:session-save') {
        const request = parsed.data;
        return sessionQueue.run(async () => {
          const stored = await chrome.storage.local.get(REDGIFS_SESSION_KEY);
          let value = normalizeSession(stored[REDGIFS_SESSION_KEY]);
          if (request.type === 'redgifs:session-save') {
            value = normalizeSession({ ...value, ...request.patch });
            await chrome.storage.local.set({ [REDGIFS_SESSION_KEY]: value });
          }
          return { ok: true, value };
        });
      }
      if (parsed.data.type === 'redgifs:open-tab') {
        await chrome.tabs.create({ url: parsed.data.url, active: true }); return { ok: true };
      }
      return chrome.tabs.sendMessage(tab.id!, parsed.data, { frameId: 0 });
    })().then(respond, () => respond({ ok: false, error: 'Could not reach CtrlEm. Reopen the panel.' }));
    return true;
  });
}
