import type { Library } from '../model/library';

/** Reuses the existing library:changed contract so an open library shows a remote save. */
export async function notifyLibraryChanged(library: Library): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ url: ['https://ctrlem.com/u/*', 'https://ctrlem.com/groups/*'] });
    await Promise.all(tabs.map(tab => tab.id === undefined ? undefined
      : chrome.tabs.sendMessage(tab.id, { type: 'library:changed', library }).catch(() => undefined)));
  } catch { console.warn('[CtrlEm DB] Could not notify other tabs.'); }
}
