import type { Item } from '../model/library';

export type MediaType = 'image' | 'sound' | 'video';

/** One preview per tab. No library, field or Send capabilities. */
export class MediaPreview {
  private element?: HTMLElement;
  private media?: HTMLImageElement | HTMLMediaElement;
  private initiator?: HTMLElement;
  private release?: () => void;

  constructor(private readonly document: Document) {}

  open(type: MediaType, item: Item, beside: HTMLElement, initiator: HTMLElement): void {
    this.close(false);
    this.initiator = initiator;
    const region = this.document.createElement('section');
    region.className = 'ctrlem-db-preview'; region.setAttribute('aria-label', 'Media preview');
    const title = this.document.createElement('p'); title.textContent = item.label || item.value;
    const status = this.document.createElement('p'); status.setAttribute('role', 'status');
    const url = this.document.createElement('p'); url.textContent = item.value; url.hidden = true;
    const retry = this.document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry'; retry.hidden = true;
    const close = this.document.createElement('button'); close.type = 'button'; close.textContent = 'Close preview';
    close.addEventListener('click', () => this.close());
    region.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); this.close(); } });
    const load = () => {
      this.releaseMedia();
      status.textContent = 'Loading preview…'; retry.hidden = true; url.hidden = true;
      const media = this.document.createElement(type === 'image' ? 'img' : type === 'sound' ? 'audio' : 'video');
      this.media = media;
      const ready = () => { status.textContent = ''; };
      const failed = () => { status.textContent = 'Preview unavailable'; url.hidden = false; retry.hidden = false; };
      const readyEvent = type === 'image' ? 'load' : 'loadeddata';
      media.addEventListener(readyEvent, ready); media.addEventListener('error', failed);
      this.release = () => { media.removeEventListener(readyEvent, ready); media.removeEventListener('error', failed); };
      if (media instanceof this.document.defaultView!.HTMLImageElement) {
        media.alt = item.label || 'Image preview'; media.referrerPolicy = 'no-referrer';
      } else { media.controls = true; media.preload = 'auto'; media.autoplay = false; }
      media.src = item.value; region.insertBefore(media, status);
    };
    retry.addEventListener('click', load);
    region.append(title, status, url, retry, close); beside.append(region); this.element = region;
    load(); close.focus({ preventScroll: true });
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
    if (restoreFocus) {
      const target = this.initiator?.isConnected ? this.initiator : this.document.querySelector<HTMLElement>('.ctrlem-db-button');
      target?.focus({ preventScroll: true });
    }
    this.initiator = undefined;
  }
}
