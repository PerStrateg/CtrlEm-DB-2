import type { MediaResource } from '../domain/media-resource';

export class MediaActionBar {
  readonly element: HTMLDivElement;
  private resource: MediaResource;
  private readonly button: HTMLButtonElement;
  constructor(document: Document, resource: MediaResource, open: (resource: MediaResource, anchor: HTMLElement) => void) {
    this.resource = resource; this.element = document.createElement('div'); this.element.className = 'ctrlem-media-actions';
    const button = document.createElement('button'); this.button = button; button.type = 'button'; button.className = 'ctrlem-media-trigger';
    button.textContent = 'C'; button.title = 'Open CtrlEm'; button.setAttribute('aria-label', 'Open CtrlEm media actions');
    for (const event of ['pointerdown', 'mousedown', 'touchstart']) button.addEventListener(event, stop, true);
    button.addEventListener('click', event => { stop(event); open(this.resource, button); }, true); this.element.append(button);
  }
  set(resource: MediaResource): void { this.resource = resource; if (this.button.parentElement !== this.element) this.element.append(this.button); }
  remove(): void { const parent = this.element.parentElement; this.element.remove(); if (parent && !parent.querySelector('.ctrlem-media-actions')) parent.classList.remove('ctrlem-media-host'); }
}
function stop(event: Event): void { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); }
