import { CtrlemRecipientDirectoryAdapter } from '../media/adapters/ctrlem-recipient-directory';
import { mediaSettingsSchema } from '../media/domain/media-settings';
import { mediaComposerPreferencesSchema } from '../media/domain/media-composer';
import { mediaSettingsRequestSchema } from '../shared/media-settings-protocol';
import { MediaSettingsRepository } from '../storage/media-settings-store';
import { MediaComposerRepository } from '../storage/media-composer-store';
import { WriteQueue } from '../storage/library-store';

export function registerMediaSettings(): { settings: MediaSettingsRepository; composer: MediaComposerRepository } {
  const repository = new MediaSettingsRepository(chrome.storage.local);
  const composer = new MediaComposerRepository(chrome.storage.local);
  const writes = new WriteQueue();
  const directory = new CtrlemRecipientDirectoryAdapter(fetch, diagnostic => {
    const method = diagnostic.event === 'failure' ? 'warn' : 'info';
    console[method]('[CtrlEm DB][recipient-api]', diagnostic);
  });
  const popupUrl = chrome.runtime.getURL('popup.html');
  const settingsUrl = chrome.runtime.getURL('settings.html');

  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    if (!(input as { type?: string })?.type?.startsWith('media-settings:')) return false;
    const parsed = mediaSettingsRequestSchema.safeParse(input);
    const extensionPage = sender.id === chrome.runtime.id && (sender.url === popupUrl || sender.url === settingsUrl);
    const webPage = sender.id === chrome.runtime.id && sender.tab?.id !== undefined && isWeb(sender.url);
    if (!parsed.success || (!extensionPage && !webPage)) {
      respond({ ok: false, error: 'Request not allowed.' }); return false;
    }
    const operation = parsed.data.type === 'media-settings:get' ? repository.read()
      : parsed.data.type === 'media-settings:composer-get' ? composer.read()
      : parsed.data.type === 'media-settings:recipients' ? directory.search(parsed.data.search.kind, parsed.data.search.query)
      : parsed.data.type === 'media-settings:composer-save' ? saveComposer(parsed.data.preferences)
      : save(parsed.data.settings);
    void operation.then(value => respond({ ok: true, value }), error => {
      const unauthorized = error instanceof Error && /401|403/.test(error.message);
      respond({ ok: false, error: unauthorized ? 'Sign in to CtrlEm.' : 'Couldn’t load CtrlEm. Retry.' });
    });
    return true;
  });
  const save = (input: unknown) => writes.run(async () => {
    const settings = mediaSettingsSchema.parse(input);
    await repository.save(settings); await broadcast(settings); return settings;
  });
  const saveComposer = (input: unknown) => writes.run(async () => {
    const preferences = mediaComposerPreferencesSchema.parse(input);
    await composer.save(preferences); return preferences;
  });
  return { settings: repository, composer };
}

function isWeb(value?: string): boolean {
  try { return Boolean(value && ['http:', 'https:'].includes(new URL(value).protocol)); } catch { return false; }
}

async function broadcast(settings: ReturnType<typeof mediaSettingsSchema.parse>): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.all(tabs.map(tab => tab.id === undefined ? undefined :
    chrome.tabs.sendMessage(tab.id, { type: 'media-settings:changed', settings }).catch(() => undefined)));
}
