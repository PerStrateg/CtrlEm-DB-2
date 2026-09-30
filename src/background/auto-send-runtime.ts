import { AutoSendError, AutoSendService } from './auto-send-service';
import { AutoSendRepository } from '../storage/auto-send-store';
import { LibraryRepository } from '../storage/library-store';
import { autoSendLimits } from '../model/auto-send';
import type { AutoOutcome } from '../model/auto-send';
import { autoRequestSchema } from '../shared/auto-send-protocol';
import type { AutoPageState, AutoSnapshot } from '../shared/auto-send-protocol';
import { receiverFromUrl, receiverUrl } from '../model/send-command';
import { authorizedTab } from './library-service';
import { WriteQueue } from '../storage/library-store';
import type { FilesSource } from './files-service';
import { CtrlemCommandApiAdapter, reportCommandApi } from '../commands/adapters/ctrlem-command-api';

const alarmName = 'ctrlem.auto-send.wake';
const recipient = receiverFromUrl;

export function registerAutoSend(queue: WriteQueue, files?: FilesSource): AutoSendService {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let alarmAt: number | undefined;
  const tabs = () => chrome.tabs.query({ url: ['https://ctrlem.com/u/*', 'https://ctrlem.com/groups/*'] });
  const probe = async (tabId: number): Promise<AutoPageState | undefined> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        chrome.tabs.sendMessage(tabId, { type: 'auto:probe' }, { frameId: 0 }) as Promise<AutoPageState>,
        new Promise<undefined>(resolve => { timeout = setTimeout(() => resolve(undefined), autoSendLimits.probeTimeoutMs); }),
      ]);
    } catch { return undefined; }
    finally { clearTimeout(timeout); }
  };
  const broadcast = (snapshot: AutoSnapshot | undefined) => {
    void tabs().then(tabs => Promise.all(tabs.map(tab => tab.id === undefined ? undefined :
      chrome.tabs.sendMessage(tab.id, { type: 'auto:changed', snapshot }, { frameId: 0 }).catch(() => undefined))))
      .catch(() => console.warn('[CtrlEm DB] Could not publish task state.'));
  };
  const failed = () => { clearTimeout(timer); broadcast(undefined); };
  const commandApi = new CtrlemCommandApiAdapter(fetch, reportCommandApi);
  const scheduler = new AutoSendService(new AutoSendRepository(chrome.storage.session), new LibraryRepository(chrome.storage.local), {
    probe,
    pages: async () => (await Promise.all((await tabs()).map(async tab => {
      if (tab.id === undefined) return [];
      const page = await probe(tab.id);
      return page?.receiver && tab.url && page.receiver === recipient(tab.url) ? [{ tabId: tab.id, page }] : [];
    }))).flat(),
    execute: async (tabId, execution) => (await chrome.tabs.sendMessage(tabId, { type: 'auto:execute', execution }, { frameId: 0 }) as AutoOutcome | undefined)
      ?? { status: 'paused', reason: 'unknown' },
    executeApi: execution => commandApi.execute(execution),
    open: async receiver => {
      const existing = (await tabs()).find(tab => tab.url && recipient(tab.url) === receiver);
      if (existing?.id !== undefined) {
        await chrome.tabs.update(existing.id, { active: true });
        await chrome.windows.update(existing.windowId, { focused: true });
      } else await chrome.tabs.create({ url: receiverUrl(receiver) });
    },
    changed: broadcast,
    wakeAt: time => {
      clearTimeout(timer);
      if (time !== undefined) timer = setTimeout(() => { void scheduler.tick().catch(failed); }, Math.max(0, time - Date.now()));
      if (time === alarmAt) return;
      alarmAt = time;
      // Alarms recover sleeping workers; the live timer handles sub-30-second intervals.
      void (time === undefined ? chrome.alarms.clear(alarmName) : chrome.alarms.create(alarmName, { when: time })).catch(failed);
    },
  }, Date.now, queue, files);
  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    if (!(input as { type?: string })?.type?.startsWith('auto:')) return false;
    const tabId = authorizedTab(sender, chrome.runtime.id), parsed = autoRequestSchema.safeParse(input);
    if (tabId === undefined || !parsed.success) { respond({ ok: false, error: 'Request not allowed.' }); return false; }
    void scheduler.handle(tabId, recipient(sender.url!), parsed.data).then(
      value => respond({ ok: true, value }),
      error => respond({ ok: false, error: error instanceof AutoSendError ? error.message : 'Couldn’t update auto-send. Retry the connection.' }),
    );
    return true;
  });
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === alarmName) void scheduler.tick().catch(failed); });
  chrome.tabs.onRemoved.addListener(tabId => { void scheduler.removeTab(tabId).catch(failed); });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading' || change.url) void scheduler.removeTab(tabId).catch(failed);
  });
  // Session storage is cleared on extension reload/browser restart, not on worker sleep.
  void scheduler.tick().catch(failed);
  return scheduler;
}
