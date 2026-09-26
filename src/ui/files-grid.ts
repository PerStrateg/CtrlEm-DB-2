import { filesPolicy } from '../model/files';
import type { LocalImage } from '../model/files';
import { FilesClient } from '../files/files-client';

interface Card { element: HTMLButtonElement; abort?: AbortController; url?: string; animation?: AbortController; animationUrl?: string; image?: HTMLImageElement }
/** Only visible rows own DOM nodes and decoded images, including when previews are disabled. */
export class FilesGrid {
  readonly element: HTMLElement;
  private readonly canvas: HTMLElement;
  private items: LocalImage[] = [];
  private selected?: string;
  private previews = true;
  private active = false;
  private readonly cards = new Map<number, Card>();
  private readonly resize: ResizeObserver;
  private readonly client = new FilesClient();
  private columns = 1;
  constructor(private readonly doc: Document, private readonly select: (id: string) => void) {
    this.element = doc.createElement('div'); this.element.className = 'ctrlem-db-files-grid';
    this.element.setAttribute('role', 'group'); this.element.setAttribute('aria-label', 'Local images');
    this.canvas = doc.createElement('div'); this.canvas.className = 'ctrlem-db-files-canvas'; this.element.append(this.canvas);
    this.element.addEventListener('scroll', () => this.draw());
    this.resize = new doc.defaultView!.ResizeObserver(() => this.draw()); this.resize.observe(this.element);
    this.element.addEventListener('keydown', event => {
      const index = Number((event.target as HTMLElement).closest<HTMLElement>('[data-index]')?.dataset.index);
      if (!Number.isFinite(index)) return;
      const offset = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: this.columns, ArrowUp: -this.columns }[event.key];
      if (offset === undefined) return;
      const next = Math.min(this.items.length - 1, Math.max(0, index + offset));
      event.preventDefault(); this.select(this.items[next]!.id);
      const top = Math.floor(next / this.columns) * (filesPolicy.cardSize + filesPolicy.gap);
      if (top < this.element.scrollTop || top + filesPolicy.cardSize > this.element.scrollTop + this.element.clientHeight) this.element.scrollTop = top;
      this.draw(); this.cards.get(next)?.element.focus({ preventScroll: true });
    });
  }
  render(items: LocalImage[], selected: string | undefined, previews: boolean, active: boolean): void {
    const selectionChanged = selected !== this.selected;
    const changed = items.length !== this.items.length || items.some((item, i) => item.id !== this.items[i]?.id);
    if (changed || previews !== this.previews || !active) this.releaseAll();
    this.items = items; this.selected = selected; this.previews = previews; this.active = active; this.draw();
    if (active && selectionChanged && selected) {
      const index = items.findIndex(item => item.id === selected);
      if (index >= 0) {
        const top = Math.floor(index / this.columns) * (filesPolicy.cardSize + filesPolicy.gap);
        if (top < this.element.scrollTop) this.element.scrollTop = top;
        else if (top + filesPolicy.cardSize > this.element.scrollTop + this.element.clientHeight) this.element.scrollTop = top + filesPolicy.cardSize - this.element.clientHeight;
        this.draw();
      }
    }
  }
  private release(card: Card): void {
    card.abort?.abort(); card.animation?.abort();
    if (card.url) URL.revokeObjectURL(card.url); if (card.animationUrl) URL.revokeObjectURL(card.animationUrl);
    card.image?.removeAttribute('src'); card.element.remove();
  }
  private releaseAll(): void { for (const card of this.cards.values()) this.release(card); this.cards.clear(); }
  private draw(): void {
    if (!this.active) return;
    const stride = filesPolicy.cardSize + filesPolicy.gap;
    this.columns = Math.max(1, Math.floor((this.element.clientWidth + filesPolicy.gap) / stride));
    const first = Math.max(0, Math.floor(this.element.scrollTop / stride) - filesPolicy.overscanRows) * this.columns;
    const last = Math.min(this.items.length, (Math.ceil((this.element.scrollTop + this.element.clientHeight) / stride) + filesPolicy.overscanRows) * this.columns);
    this.canvas.style.height = `${Math.ceil(this.items.length / this.columns) * stride}px`;
    for (const [index, card] of this.cards) if (index < first || index >= last) { this.release(card); this.cards.delete(index); }
    for (let i = first; i < last; i++) {
      const item = this.items[i]!;
      let card = this.cards.get(i);
      if (!card) {
        const element = this.doc.createElement('button'); element.type = 'button'; element.className = 'ctrlem-db-files-card';
        element.dataset.index = String(i); element.setAttribute('aria-label', `Image ${i + 1}`);
        this.canvas.append(element);
        card = { element }; this.cards.set(i, card);
        element.addEventListener('click', () => this.select(item.id));
        if (this.previews) {
          const abort = card.abort = new AbortController(); const owned = card;
          let animate: (() => void) | undefined;
          void this.client.get(item.id, 'preview', abort.signal).then(blob => {
            if (abort.signal.aborted) return;
            const image = this.doc.createElement('img'); image.alt = ''; image.decoding = 'async';
            owned.url = URL.createObjectURL(blob); image.src = owned.url; owned.image = image; element.prepend(image);
            if (element.matches(':hover') || this.doc.activeElement === element) animate?.();
          }).catch(error => { if (!abort.signal.aborted) { element.dataset.previewError = 'true'; element.title = error.message; } });
          if (['image/gif', 'image/webp', 'image/png'].includes(item.mime)) {
            animate = () => {
              if (owned.animation || !owned.image) return;
              const controller = owned.animation = new AbortController();
              void this.client.get(item.id, 'original', controller.signal).then(blob => {
                if (controller.signal.aborted || !owned.image) return;
                owned.animationUrl = URL.createObjectURL(blob); owned.image.src = owned.animationUrl;
              }).catch(() => {});
            };
            const stop = () => {
              owned.animation?.abort(); owned.animation = undefined;
              if (owned.image && owned.url) owned.image.src = owned.url;
              if (owned.animationUrl) URL.revokeObjectURL(owned.animationUrl); owned.animationUrl = undefined;
            };
            element.addEventListener('pointerenter', animate); element.addEventListener('focus', animate);
            element.addEventListener('pointerleave', stop); element.addEventListener('blur', stop);
          }
        }
      }
      card.element.style.transform = `translate(${i % this.columns * stride}px, ${Math.floor(i / this.columns) * stride}px)`;
      card.element.setAttribute('aria-pressed', String(item.id === this.selected));
      card.element.dataset.uploaded = String(Boolean(item.uploadId));
      card.element.setAttribute('aria-description', item.uploadId ? 'Uploaded to CtrlEm' : 'Not uploaded to CtrlEm');
      card.element.classList.toggle('ctrlem-db-files-no-preview', !this.previews);
    }
  }
  dispose(): void { this.releaseAll(); this.resize.disconnect(); }
}
