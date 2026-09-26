import { installRedgifsNativeFeedViewport } from './redgifs-native-feed';
import { installRedgifsFeedFocus } from './redgifs-feed-focus';
import { isCtrlEmOverlayFrame } from './overlay-frame';

/**
 * Must run in the page world before RedGifs reads its responsive viewport.
 */
function main(): void {
    if (!isCtrlEmOverlayFrame(window, 'rg')) return;
    installRedgifsFeedFocus(window);
    installRedgifsNativeFeedViewport(window);
}

main();
