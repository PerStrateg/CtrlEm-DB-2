import { mediaActions, type MediaAction, type MediaResource } from '../domain/media-resource';
import type { MediaSendPort } from '../ports/media-send-port';
import { MediaSendButton } from './media-send-button';

export class MediaActionBar {
  readonly element: HTMLDivElement;
  private readonly buttons = new Map<MediaAction, MediaSendButton>();

  constructor(document: Document, sender: MediaSendPort, resource: MediaResource) {
    this.element = document.createElement('div');
    this.element.className = 'ctrlem-media-actions';
    for (const action of mediaActions(resource.kind)) {
      const button = new MediaSendButton(document, action, sender);
      button.set(resource);
      this.buttons.set(action, button);
      this.element.append(button.element);
    }
  }

  set(resource: MediaResource): void {
    for (const button of this.buttons.values()) {
      button.set(resource);
      if (button.element.parentElement !== this.element) this.element.append(button.element);
    }
  }

  remove(): void {
    for (const button of this.buttons.values()) button.remove();
    const parent = this.element.parentElement;
    this.element.remove();
    if (parent && !parent.querySelector('.ctrlem-media-actions')) parent.classList.remove('ctrlem-media-host');
  }
}
