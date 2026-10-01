import { ExtensionMediaSettingsClient } from '../media/adapters/extension-media-settings-client';
import { extensionMediaAccess } from '../media/adapters/extension-media-access';
import { MediaSettingsView } from '../media/ui/media-settings-view';
import { mountInfoTips } from '../ui/info-tip';
import type { Credentials, CredentialsRequest } from '../shared/credentials-protocol';
import type { Reply } from '../shared/library-protocol';
import '../ui/info-tip.css';
import '../ui/common.css';
import '../ui/media-settings.css';
import '../ui/extension-theme.css';
import './settings.css';
import { mountProviderAccess } from './provider-access-view';
import { mountImageCacheSettings } from './image-cache-view';
import { mountSettings } from './settings-view';
import { mountWebsiteAccess } from './website-access-view';
import { websiteAccess } from '../shared/website-access';

const root = document.querySelector('main')!;
const embedded = window.top !== window;
const access = extensionMediaAccess(chrome.runtime);
const uploads = document.createElement('section'); uploads.className = 'ctrlem-db-settings-block';
const storage = document.createElement('div'); storage.className = 'ctrlem-db-settings-block';
const media = new MediaSettingsView(document, new ExtensionMediaSettingsClient(), undefined,
  { access });
root.append(media.element, uploads, storage); void media.load();
mountInfoTips(document);
mountWebsiteAccess(document, access, root, embedded ? undefined : () => chrome.permissions.request(websiteAccess));
mountImageCacheSettings(document, storage);
document.body.classList.toggle('embedded', embedded);
if (embedded) {
  const observer = new ResizeObserver(() => {
    const height = Math.ceil(root.getBoundingClientRect().height);
    window.parent.postMessage({ type: 'ctrlem-db:settings-height', height }, 'https://ctrlem.com');
  });
  observer.observe(root);
}

async function request<T>(message: CredentialsRequest): Promise<T> {
  const reply: Reply<T> = await chrome.runtime.sendMessage(message);
  if (!reply.ok) throw new Error('Couldn’t complete settings operation.');
  return reply.value;
}
void mountSettings(document, {
  load: () => request<Credentials>({ type: 'credentials:load' }),
  save: (field, value) => request<void>({ type: 'credentials:save', field, value }),
}, uploads, (id, section) => {
  if (!embedded && id === 'catbox') mountProviderAccess(document, chrome.permissions, section);
});
