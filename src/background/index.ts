import { notifyLibraryChanged } from './library-events';
import { registerRedgifs } from './redgifs-runtime';
import { registerRedgifsAdblock } from './redgifs-adblock';
import { receiverFromUrl } from '../model/send-command';
import { authorizedTab, LibraryService } from './library-service';
import { EditorSessionRepository, LibraryReadError, LibraryRepository } from '../storage/library-store';
import type { ChangeResult } from '../model/library';
import { SelectionRepository } from '../storage/selection-store';
import { CredentialsRepository, openCredentialKey } from '../storage/credentials-store';
import { authorizedSettings, credentialsRequest } from '../shared/credentials-protocol';
import { WriteQueue } from '../storage/library-store';
import { UploadSession } from './upload-service';
import { uploadPortName, uploadReadyRequest } from '../shared/upload-protocol';
import { diagnosticUploadFetch } from './upload-network';
import { catboxAccess } from '../shared/provider-access';
import { registerAutoSend } from './auto-send-runtime';
import { registerWebsiteAccessOnboarding } from './website-access-runtime';
import { registerImageCache } from './image-cache-runtime';
import { imageCachePort } from '../shared/image-cache-protocol';
import { IntervalRepository } from '../storage/interval-store';
import { intervalRequestSchema } from '../shared/interval-protocol';
import { createFilesService, registerFiles } from './files-runtime';
import { filesPort } from '../shared/files-protocol';
import { registerMediaSend } from './media-send-runtime';
import { registerMediaSettings } from './media-settings-runtime';
import { registerRemoteMediaLibrary } from './remote-media-library-runtime';
import { remoteMediaUploadPort } from '../shared/media-library-protocol';
import { imageProcessorPort } from '../files/image-processor-protocol';
import { NativeImageService } from '../uploads/native-image-service';
import { UploadOwnershipRepository } from '../storage/upload-ownership-store';
import { CtrlemUploadsAdapter } from '../uploads/adapters/ctrlem-uploads';
import { AutoSendRepository } from '../storage/auto-send-store';
import { protectedUploadSources } from '../uploads/domain/protected-uploads';
import { MediaDeliveryService } from '../media/media-delivery-service';
import { downloadRemoteMediaFile } from '../media/adapters/remote-media-reader';
import { providers } from '../upload/providers';

const libraryQueue = new WriteQueue();
const images = new NativeImageService(new CtrlemUploadsAdapter(), new UploadOwnershipRepository(chrome.storage.local),
  async () => protectedUploadSources(await new AutoSendRepository(chrome.storage.session).read()));
const files = createFilesService(images);
const delivery = new MediaDeliveryService(images, {
  download: (resource, signal) => downloadRemoteMediaFile(resource, fetch, signal, () => {}, providers.imgbb.maxBytes),
  prepare: (blob, signal) => files.processor.run({ token: crypto.randomUUID(), part: 'prepared' }, blob, signal, () => {}),
});
const scheduler = registerAutoSend(libraryQueue, files);
const mediaSettings = registerMediaSettings();
registerMediaSend(scheduler, mediaSettings.settings, delivery);
registerFiles(files, () => scheduler.clearFiles(), id => scheduler.removeFile(id, () => files.remove(id)));
registerImageCache();
registerRedgifs();
registerRedgifsAdblock();
registerWebsiteAccessOnboarding(chrome.permissions, chrome.runtime, () => void chrome.runtime.openOptionsPage());

const credentials = new CredentialsRepository(chrome.storage.local, openCredentialKey);
const credentialsQueue = new WriteQueue();
const intervals = new IntervalRepository(chrome.storage.local);
const intervalsQueue = new WriteQueue();
const uploadRequest = diagnosticUploadFetch(chrome.webRequest, chrome.runtime.getURL(''), fetch, chrome.permissions);

const accessChanged = () => {
  void chrome.tabs.query({ url: ['https://ctrlem.com/u/*', 'https://ctrlem.com/groups/*'] }).then(tabs => Promise.all(tabs.map(tab =>
    tab.id === undefined ? undefined : chrome.tabs.sendMessage(tab.id, { type: 'upload:settings-changed' }).catch(() => undefined)
  ))).catch(() => console.warn('[CtrlEm DB] Could not notify provider access change.'));
};
chrome.permissions.onAdded.addListener(accessChanged);
chrome.permissions.onRemoved.addListener(accessChanged);

chrome.runtime.onConnect.addListener(port => {
  if ([imageCachePort, filesPort, remoteMediaUploadPort, imageProcessorPort].includes(port.name)) return;
  if (port.name !== uploadPortName || !port.sender || authorizedTab(port.sender, chrome.runtime.id) === undefined) { port.disconnect(); return; }
  const upload = new UploadSession(credentials, uploadRequest, () => chrome.permissions.contains(catboxAccess));
  let connected = true;
  port.onMessage.addListener((input: unknown) => {
    void upload.handle(input).then(reply => { if (connected && reply) port.postMessage(reply); });
  });
  port.onDisconnect.addListener(() => { connected = false; upload.close(); });
});

const library = new LibraryRepository(chrome.storage.local);
registerRemoteMediaLibrary(library, libraryQueue, credentials, uploadRequest);
const service = new LibraryService(
  library, new EditorSessionRepository(chrome.storage.session),
  new SelectionRepository(chrome.storage.local), libraryQueue, () => scheduler.libraryChanged(),
);

// Register listeners synchronously for service-worker/event-page wakeups.
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if ((message as { type?: string })?.type?.startsWith('files:')) return false;
  if ((message as { type?: string })?.type?.startsWith('redgifs:')) return false;
  if ((message as { type?: string })?.type?.startsWith('media-send:')) return false;
  if ((message as { type?: string })?.type?.startsWith('media-settings:')) return false;
  if ((message as { type?: string })?.type?.startsWith('media-library:')) return false;
  if ((message as { type?: string })?.type?.startsWith('interval:')) {
    const parsed = intervalRequestSchema.safeParse(message);
    if (authorizedTab(sender, chrome.runtime.id) === undefined || !parsed.success) {
      respond({ ok: false, error: 'Request not allowed.' }); return false;
    }
    void intervalsQueue.run(async () => {
      if (parsed.data.type === 'interval:save') await intervals.save(parsed.data.command, parsed.data.seconds);
      else return intervals.read();
    }).then(value => respond({ ok: true, value }), () => respond({ ok: false, error: 'Couldn’t save interval. Retry.' }));
    return true;
  }
  if ((message as { type?: string })?.type?.startsWith('image-cache:')) return false;
  if ((message as { type?: string })?.type?.startsWith('auto:')) return false;
  if (authorizedSettings(sender, chrome.runtime.id, chrome.runtime.getURL('settings.html'))) {
    void credentialsQueue.run(async () => {
      const request = credentialsRequest.parse(message);
      if (request.type === 'credentials:load') return credentials.read();
      await credentials.save(request.field, request.value);
      if (request.field === 'imgbb') {
        // Notification failure must not turn a completed credential save into an error.
        void chrome.tabs.query({ url: ['https://ctrlem.com/u/*', 'https://ctrlem.com/groups/*'] }).then(tabs =>
          Promise.all(tabs.map(tab => tab.id === undefined ? undefined :
            chrome.tabs.sendMessage(tab.id, { type: 'upload:settings-changed' }).catch(() => undefined)))
        ).catch(() => console.warn('[CtrlEm DB] Could not notify provider settings change.'));
      }
    }).then(value => respond({ ok: true, value }), () => respond({ ok: false, error: 'Couldn’t complete settings operation. Retry.' }));
    return true;
  }
  const tabId = authorizedTab(sender, chrome.runtime.id);
  if (tabId === undefined) {
    respond({ ok: false, error: 'Request not allowed.' });
    return false;
  }
  if ((message as { type?: string })?.type === 'upload:catbox-access') {
    void chrome.permissions.contains(catboxAccess).then(value => respond({ ok: true, value }),
      () => respond({ ok: false, error: 'Couldn’t check Catbox access.' }));
    return true;
  }
  if ((message as { type?: string })?.type === 'settings:open') {
    void chrome.runtime.openOptionsPage().then(() => respond({ ok: true }),
      () => respond({ ok: false, error: 'Couldn’t open provider settings.' }));
    return true;
  }
  if (uploadReadyRequest.safeParse(message).success) {
    void credentialsQueue.run(() => credentials.readField('imgbb')).then(
      value => respond({ ok: true, value: Boolean(value) }),
      () => respond({ ok: false, error: 'Couldn’t load provider settings.' }),
    );
    return true;
  }
  void (async () => {
    try {
      const receiver = receiverFromUrl(sender.url!);
      const value = await service.handle(tabId, message, receiver);
      respond({ ok: true, value });
      if (['library:change', 'library:capture', 'library:import', 'library:add-upload'].includes((message as { type: string }).type)) {
        const result = value as Pick<ChangeResult, 'library'> & { status: string };
        if (result.status === 'saved') {
          await notifyLibraryChanged(result.library);
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
