import { ExtensionMediaSettingsClient } from '../media/adapters/extension-media-settings-client';
import { MediaSettingsView } from '../media/ui/media-settings-view';
import './popup.css';

void (async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host: string | undefined;
  try { const url = new URL(tab?.url ?? ''); if (['http:', 'https:'].includes(url.protocol)) host = url.hostname.toLowerCase(); }
  catch { /* The active browser page is not a website. */ }
  const view = new MediaSettingsView(document, new ExtensionMediaSettingsClient(), host);
  document.body.append(view.element); await view.load();
})();
