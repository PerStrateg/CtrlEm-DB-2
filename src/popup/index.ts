import { ExtensionMediaSettingsClient } from '../media/adapters/extension-media-settings-client';
import { extensionMediaAccess } from '../media/adapters/extension-media-access';
import { MediaSettingsView } from '../media/ui/media-settings-view';
import { mountInfoTips } from '../ui/info-tip';
import '../ui/info-tip.css';
import '../ui/common.css';
import '../ui/extension-theme.css';
import '../ui/media-settings.css';
import './popup-shell.css';

void (async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host: string | undefined;
  try { const url = new URL(tab?.url ?? ''); if (['http:', 'https:'].includes(url.protocol)) host = url.hostname.toLowerCase(); }
  catch { /* The active browser page is not a website. */ }
  const view = new MediaSettingsView(document, new ExtensionMediaSettingsClient(), host,
    { access: extensionMediaAccess(chrome.runtime), refreshTab: tab?.id });
  document.body.append(view.element); await view.load();
  mountInfoTips(document);
})();
