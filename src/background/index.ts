import { authorizedTab, LibraryService } from './library-service';
import { EditorSessionRepository, LibraryReadError, LibraryRepository } from '../storage/library-store';
import type { ChangeResult } from '../model/library';
import { SelectionRepository } from '../storage/selection-store';

const service = new LibraryService(
  new LibraryRepository(chrome.storage.local), new EditorSessionRepository(chrome.storage.session),
  new SelectionRepository(chrome.storage.local),
);

// Register listeners synchronously for service-worker/event-page wakeups.
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  const tabId = authorizedTab(sender, chrome.runtime.id);
  if (tabId === undefined) {
    respond({ ok: false, error: 'Request not allowed.' });
    return false;
  }
  void (async () => {
    try {
      const receiver = new URL(sender.url!).pathname.split('/')[2]!;
      const value = await service.handle(tabId, message, receiver);
      respond({ ok: true, value });
      if (['library:change', 'library:capture', 'library:import'].includes((message as { type: string }).type)) {
        const result = value as Pick<ChangeResult, 'library'> & { status: string };
        if (result.status === 'saved') {
          try {
            const tabs = await chrome.tabs.query({ url: 'https://ctrlem.com/u/*' });
            await Promise.all(tabs.map(async tab => {
              if (tab.id === undefined) return;
              // Tabs can close or have no receiver between query and delivery.
              await chrome.tabs.sendMessage(tab.id, { type: 'library:changed', library: result.library }).catch(() => undefined);
            }));
          } catch { console.warn('[CtrlEm DB] Could not notify other tabs.'); }
        }
      }
    } catch (error) {
      // Never send arbitrary storage/validation exceptions or stored values to the page.
      respond({ ok: false, error: error instanceof LibraryReadError ? error.message : 'Couldn’t complete the library operation. Retry without closing this tab.' });
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  void service.removeTab(tabId).catch(() => console.warn('[CtrlEm DB] Could not remove closed-tab drafts.'));
});
