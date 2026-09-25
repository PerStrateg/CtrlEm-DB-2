import type { Item } from '../model/library';

export type MediaType = 'image' | 'sound' | 'video';

/** One preview per tab. No library, field or Send capabilities. */
export class MediaPreview {
  private element?: HTMLElement;
  private media?: HTMLImageElement | HTMLMediaElement;
  private initiator?: HTMLElement;
  private release?: () => void;
  private activeItem?: string;
  private readonly escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopPropagation(); this.close(); }
  };

  constructor(private readonly document: Document) {}

  toggle(type: MediaType, item: Item, beside: HTMLElement, initiator: HTMLElement): void {
    const identity = JSON.stringify([type, item.id, item.value]);
    if (this.element && this.initiator === initiator && this.activeItem === identity) { this.close(); return; }
    this.close(false);
    this.activeItem = identity;
    this.initiator = initiator;
    initiator.setAttribute('aria-expanded', 'true');
    initiator.addEventListener('keydown', this.escape);
    const region = this.document.createElement('section');
    region.className = 'ctrlem-db-preview ctrlem-db-ui'; region.setAttribute('aria-label', 'Media preview');
    const title = this.document.createElement('p'); title.textContent = item.label || item.value;
    const status = this.document.createElement('p'); status.setAttribute('role', 'status');
    const url = this.document.createElement('p'); url.textContent = item.value; url.hidden = true;
    const retry = this.document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry'; retry.hidden = true;
    region.addEventListener('keydown', this.escape);
    const load = () => {
      this.releaseMedia();
      status.textContent = 'Loading preview…'; retry.hidden = true; url.hidden = true;
      const media = this.document.createElement(type === 'image' ? 'img' : type === 'sound' ? 'audio' : 'video');
      this.media = media;
      const ready = () => { status.textContent = ''; };
      const failed = () => { status.textContent = 'Preview unavailable'; url.hidden = false; retry.hidden = false; };
      const readyEvent = type === 'image' ? 'load' : 'loadedmetadata';
      media.addEventListener(readyEvent, ready); media.addEventListener('error', failed);
      this.release = () => { media.removeEventListener(readyEvent, ready); media.removeEventListener('error', failed); };
      if (media instanceof this.document.defaultView!.HTMLImageElement) {
        media.alt = item.label || 'Image preview'; media.referrerPolicy = 'no-referrer';
      } else { media.controls = true; media.preload = 'metadata'; media.autoplay = false; }
      media.src = item.value; region.insertBefore(media, status);
    };
    retry.addEventListener('click', load);
    region.append(title, status, url, retry); beside.append(region); this.element = region;
    load(); initiator.focus({ preventScroll: true });
  }

  private releaseMedia(): void {
    this.release?.(); this.release = undefined;
    const media = this.media;
    if (!media) return;
    if (media instanceof this.document.defaultView!.HTMLMediaElement) {
      media.pause(); media.removeAttribute('src'); media.load();
    } else media.removeAttribute('src');
    media.remove(); this.media = undefined;
  }

  reconcile(): void {
    if (this.element && (!this.element.isConnected || !this.initiator?.isConnected)) this.close(false);
  }
  close(restoreFocus = true): void {
    if (!this.element) return;
    this.releaseMedia(); this.element.remove(); this.element = undefined;
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
