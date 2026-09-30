import { ExtensionMediaClient } from './adapters/extension-media-client';
import { MediaController } from './ui/media-controller';
import './media-content.css';

const runtime = globalThis as typeof globalThis & { ctrlEmMediaController?: MediaController };
runtime.ctrlEmMediaController?.dispose();
runtime.ctrlEmMediaController = new MediaController(document, new ExtensionMediaClient());
runtime.ctrlEmMediaController.start();
