import { ExtensionMediaClient } from './adapters/extension-media-client';
import { MediaController } from './ui/media-controller';
import { ExtensionMediaSettingsClient } from './adapters/extension-media-settings-client';
import { mediaEnabledOn, type MediaSettings } from './domain/media-settings';
import './media-content.css';
import { ExtensionMediaLibraryClient } from './adapters/extension-media-library-client';

const runtime = globalThis as typeof globalThis & {
  ctrlEmMediaController?: MediaController;
  ctrlEmMediaSettingsUnsubscribe?: () => void;
};
const settings = new ExtensionMediaSettingsClient();
const render = (value: MediaSettings) => {
  runtime.ctrlEmMediaController?.dispose();
  runtime.ctrlEmMediaController = undefined;
  if (!mediaEnabledOn(value, document.location.href)) return;
  const controller = new MediaController(document, new ExtensionMediaClient(), settings, new ExtensionMediaLibraryClient(), value.showWallpaper);
  runtime.ctrlEmMediaController = controller; controller.start();
};
runtime.ctrlEmMediaController?.dispose();
runtime.ctrlEmMediaSettingsUnsubscribe?.();
runtime.ctrlEmMediaSettingsUnsubscribe = settings.subscribe(render);
void settings.load().then(render).catch(error => console.warn('[CtrlEm DB][media-settings]', {
  event: 'load-failure', message: error instanceof Error ? error.message : 'unknown',
}));
