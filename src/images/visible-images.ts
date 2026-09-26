import { ExtensionImageLoader } from './image-cache-client';
import type { ImageLoader, ImageResource } from './image-cache-client';

interface Card { url: string; visible: boolean; request?: AbortController; resource?: ImageResource; image?: HTMLImageElement; error?: HTMLElement }

/** Retains accessible cards, but owns media only while they intersect the clipped viewport. */
export class VisibleImages {
  private readonly cards = new Map<HTMLElement, Card>();
  private readonly observer: IntersectionObserver;
  private readonly unsubscribe: () => void;
  constructor(private readonly document: Document, private readonly loader: ImageLoader = new ExtensionImageLoader()) {
    this.observer = new document.defaultView!.IntersectionObserver(entries => {
      for (const entry of entries) {
        const row = entry.target as HTMLElement, card = this.cards.get(row);
        if (!card) continue;
        card.visible = entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0;
        this.sync(row, card);
      }
    }, { root: null, threshold: 0 });
    this.unsubscribe = loader.subscribe(() => {
      for (const [row, card] of this.cards) { this.release(card); this.sync(row, card); }
    });
    document.addEventListener('visibilitychange', this.visibility);
  }
  private readonly visibility = () => {
    for (const [row, card] of this.cards) this.sync(row, card);
  };
  set(row: HTMLElement, url?: string): void {
    const previous = this.cards.get(row);
    if (previous?.url === url) return;
    if (previous) { this.release(previous); this.observer.unobserve(row); this.cards.delete(row); }
    if (url) { this.cards.set(row, { url, visible: false }); this.observer.observe(row); }
  }
  private sync(row: HTMLElement, card: Card): void {
    if (!card.visible || this.document.hidden || !row.isConnected) { this.release(card); return; }
    if (card.request) return;
    const request = card.request = new AbortController();
    void this.loader.acquire(card.url, request.signal).then(resource => {
      if (card.request !== request || request.signal.aborted) { resource.release(); return; }
      card.resource = resource;
      const img = this.document.createElement('img'); img.alt = ''; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        if (card.image !== img) return;
        img.remove(); card.image = undefined; card.resource?.release(); card.resource = undefined;
        const error = this.document.createElement('small'); error.textContent = `Preview unavailable: ${card.url}`;
        card.error = error; row.append(error);
      }, { once: true });
      card.image = img; img.src = resource.src; row.prepend(img);
    }).catch(() => { /* Cancellation releases the card; no retry loop on scroll. */ });
  }
  private release(card: Card): void {
    card.request?.abort(); card.request = undefined;
    card.image?.removeAttribute('src'); card.image?.remove(); card.image = undefined;
    card.resource?.release(); card.resource = undefined;
    card.error?.remove(); card.error = undefined;
  }
  suspend(): void { for (const card of this.cards.values()) { card.visible = false; this.release(card); } }
  dispose(): void {
    this.suspend(); this.observer.disconnect(); this.unsubscribe(); this.cards.clear();
    this.document.removeEventListener('visibilitychange', this.visibility);
  }
}
