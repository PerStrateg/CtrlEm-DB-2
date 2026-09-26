import { mountInfoTips } from '../ui/info-tip';
import '../ui/info-tip.css';
import { mountSettings } from './settings-view';
import type { Credentials, CredentialsRequest } from '../shared/credentials-protocol';
import type { Reply } from '../shared/library-protocol';
import '../ui/common.css';
import '../ui/extension-theme.css';
import './settings.css';
import { mountProviderAccess } from './provider-access-view';
import { mountImageCacheSettings } from './image-cache-view';

const root = document.querySelector('main')!;
const uploads = document.createElement('section'); uploads.className = 'ctrlem-db-settings-block';
const storage = document.createElement('div'); storage.className = 'ctrlem-db-settings-block';
root.append(uploads, storage);
mountInfoTips(document);
mountImageCacheSettings(document, storage);
const embedded = window.top !== window;
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
