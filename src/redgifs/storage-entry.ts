import { isCtrlEmOverlayFrame } from './overlay-frame';
import { installEmbedCleanup } from './embed-cleanup';
import { installRedgifsEmbedRecovery } from './redgifs-embed-recovery';

if (isCtrlEmOverlayFrame()) {
  installEmbedCleanup();
  installRedgifsEmbedRecovery();
}
