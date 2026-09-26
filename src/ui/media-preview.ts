import type { Item } from '../model/library';

export type MediaType = 'sound' | 'video';

/** Owns placement and focus. Playback lives in the extension document. */
export class MediaPreview {
  private element?: HTMLElement;
  private initiator?: HTMLElement;
  private release?: () => void;
  private activeItem?: string;
  private readonly escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopPropagation(); this.close(); }
  };
  constructor(private readonly document: Document,
    private readonly previewUrl = () => chrome.runtime.getURL('preview.html')) {}

  toggle(type: MediaType, item: Item, beside: HTMLElement, initiator: HTMLElement): void {
    const identity = JSON.stringify([type, item.id, item.value]);
    if (this.element && this.initiator === initiator && this.activeItem === identity) { this.close(); return; }
    this.close(false);
    this.activeItem = identity; this.initiator = initiator;
    initiator.setAttribute('aria-expanded', 'true');
    initiator.addEventListener('keydown', this.escape);
    const region = this.document.createElement('section');
    region.className = 'ctrlem-db-preview ctrlem-db-ui'; region.setAttribute('aria-label', 'Media preview');
    const title = this.document.createElement('p'); title.textContent = item.label || (type === 'sound' ? 'Audio preview' : 'Video preview');
    const frame = this.document.createElement('iframe'); frame.title = title.textContent;
    const url = new URL(this.previewUrl());
    url.hash = new URLSearchParams({ type, url: item.value }).toString();
    frame.src = url.href; frame.style.height = type === 'sound' ? '100px' : '260px';
    frame.setAttribute('allow', 'fullscreen');
    const window = this.document.defaultView!;
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== `${url.protocol}//${url.host}`) return;
      if (event.data?.type === 'ctrlem-preview:close') this.close();
      if (event.data?.type === 'ctrlem-preview:resize' && Number.isFinite(event.data.height)) {
        frame.style.height = `${Math.min(420, Math.max(60, event.data.height))}px`;
      }
    };
    window.addEventListener('message', receive);
    this.release = () => window.removeEventListener('message', receive);
    region.addEventListener('keydown', this.escape);
    region.append(title, frame); beside.append(region); this.element = region;
    initiator.focus({ preventScroll: true });
  }
  reconcile(): void {
    if (this.element && (!this.element.isConnected || !this.initiator?.isConnected)) this.close(false);
  }
  close(restoreFocus = true): void {
    if (!this.element) return;
    this.release?.(); this.release = undefined;
    // Destroying the browsing context releases playback and its network activity.
    this.element.remove(); this.element = undefined;
    this.initiator?.setAttribute('aria-expanded', 'false');
    this.initiator?.removeEventListener('keydown', this.escape);
    this.activeItem = undefined;
    if (restoreFocus) {
      const target = this.initiator?.isConnected ? this.initiator : this.document.querySelector<HTMLElement>('.ctrlem-db-button');
      target?.focus({ preventScroll: true });
    }
    this.initiator = undefined;
  }
}
