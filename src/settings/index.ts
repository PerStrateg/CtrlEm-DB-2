import { mountSettings } from './settings-view';
import type { Credentials, CredentialsRequest } from '../shared/credentials-protocol';
import type { Reply } from '../shared/library-protocol';
import './settings.css';
import { mountProviderAccess } from './provider-access-view';

// Permission APIs are not reliably exposed to web-accessible embedded extension pages.
if (window.top === window) mountProviderAccess(document, chrome.permissions);

async function request<T>(message: CredentialsRequest): Promise<T> {
  const reply: Reply<T> = await chrome.runtime.sendMessage(message);
  if (!reply.ok) throw new Error('Couldn’t complete settings operation.');
  return reply.value;
}
void mountSettings(document, {
  load: () => request<Credentials>({ type: 'credentials:load' }),
  save: (field, value) => request<void>({ type: 'credentials:save', field, value }),
});
