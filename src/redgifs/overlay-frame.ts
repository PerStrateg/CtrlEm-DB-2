export const OVERLAY_IFRAME_ALLOW = 'storage-access; autoplay; fullscreen; encrypted-media';
export const overlayFrameName = () => 'ctrlem-db-redgifs';

/** Scope page-world adaptations to the iframe created by CtrlEm DB. */
export function isCtrlEmOverlayFrame(win: Window = window, _sourceId?: string): boolean {
  return win !== win.top && win.parent === win.top && win.name === overlayFrameName();
}
