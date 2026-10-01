import type { MediaAction, MediaResource } from '../domain/media-resource';
import type { MediaSendFeedback } from '../domain/media-send-feedback';

export interface MediaActionBarHandlers {
  send(action: MediaAction, resource: MediaResource): void;
  openSettings(anchor: HTMLElement): void;
  openSave(anchor: HTMLElement, resource: MediaResource): void;
}

interface QuickSend { action: MediaAction; label: string; icon: keyof typeof iconPaths }

const iconPaths = {
  sending: 'M12 3a9 9 0 1 1-9 9',
  sent: 'm5 12 4 4L19 6',
  failed: 'M12 4v10 M12 19h.01',
  save: 'M4 3h13l4 4v14H3V3h1Z M7 3v6h9V3 M7 21v-8h10v8',
  settings: 'm10 3-.6 2.3-2 .9-2.1-.7-2 3.5 1.6 1.6v2.8l-1.6 1.6 2 3.5 2.1-.7 2 .9.6 2.3h4l.6-2.3 2-.9 2.1.7 2-3.5-1.6-1.6v-2.8l1.6-1.6-2-3.5-2.1.7-2-.9L14 3Z M15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0',
  image: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M3 17l6-6 4 4 3-3 5 5 M17 8a1 1 0 1 1-2 0 1 1 0 1 1 2 0',
  wallpaper: 'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M3 14l5-5 5 5 3-3 5 5 M8 21h8 M12 17v4',
  video: 'M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z M10 8l6 4-6 4Z',
};

/** Images get a popup and a wallpaper shortcut, videos only the popup overlay. */
const quickSends: Record<MediaResource['kind'], QuickSend[]> = {
  image: [
    { action: 'popup-image', label: 'Send image', icon: 'image' },
    { action: 'wallpaper', label: 'Send as wallpaper', icon: 'wallpaper' },
  ],
  video: [{ action: 'video-overlay', label: 'Send video', icon: 'video' }],
};

export class MediaActionBar {
  readonly element: HTMLDivElement;
  private resource: MediaResource;
  private readonly sendButtons = new Map<MediaAction, HTMLButtonElement>();
  private readonly stack: HTMLDivElement;
  private readonly save: HTMLButtonElement;
  private readonly settings: HTMLButtonElement;
  private names = '';
  private readonly feedback = new Map<MediaAction, MediaSendFeedback>();

  get currentResource(): MediaResource { return this.resource; }

  constructor(private readonly document: Document, resource: MediaResource, private readonly handlers: MediaActionBarHandlers) {
    this.resource = resource;
    this.element = document.createElement('div');
    this.element.className = 'ctrlem-media-actions';
    this.save = this.icon('ctrlem-media-save', 'Save to library', 'save');
    this.settings = this.icon('ctrlem-media-trigger ctrlem-media-gear', 'Recipients', 'settings');
    this.settings.addEventListener('click', event => { stop(event); this.handlers.openSettings(this.settings); });
    this.save.addEventListener('click', event => { stop(event); this.handlers.openSave(this.save, this.resource); });
    for (const send of quickSends.image.concat(quickSends.video)) {
      const button = this.icon(`ctrlem-media-send ctrlem-media-send-${send.action}`, send.label, send.icon);
      button.addEventListener('click', event => {
        stop(event);
        if (button.getAttribute('aria-disabled') !== 'true') this.handlers.send(send.action, this.resource);
      });
      this.sendButtons.set(send.action, button);
    }
    this.stack = document.createElement('div');
    this.stack.className = 'ctrlem-media-stack';
    this.stack.append(this.save, this.settings);
    this.save.setAttribute('aria-haspopup', 'dialog');
    this.settings.setAttribute('aria-haspopup', 'dialog');
    this.set(resource);
  }

  set(resource: MediaResource): void {
    this.resource = resource;
    const stack = [this.save, this.settings];
    if (!sameChildren(this.stack, stack)) this.stack.replaceChildren(...stack);
    const children = [...quickSends[resource.kind].map(send => this.sendButtons.get(send.action)!), this.stack];
    if (!sameChildren(this.element, children)) this.element.replaceChildren(...children);
    this.applyRecipients(this.names);
  }

  /** Quick send stays hidden until common recipients exist; the hint then names them, nothing else. */
  applyRecipients(names: string): void {
    this.names = names;
    for (const send of quickSends[this.resource.kind]) {
      const button = this.sendButtons.get(send.action)!;
      button.hidden = !names;
      if (!names) continue;
      this.renderFeedback(send, button);
      button.removeAttribute('title');
    }
  }

  setFeedback(action: MediaAction, value?: MediaSendFeedback): void {
    if (value) this.feedback.set(action, value); else this.feedback.delete(action);
    const send = quickSends[this.resource.kind].find(send => send.action === action);
    if (send) this.renderFeedback(send, this.sendButtons.get(action)!);
  }

  private renderFeedback(send: QuickSend, button: HTMLButtonElement): void {
    const value = this.feedback.get(send.action);
    const status = value?.status ?? 'idle';
    button.dataset.sendState = status;
    button.setAttribute('aria-busy', String(status === 'sending'));
    button.setAttribute('aria-disabled', String(status === 'sending'));
    button.setAttribute('aria-label', value?.message ?? send.label);
    button.dataset.info = value ? `${value.message}\n${this.names}` : this.names;
    const path = button.querySelector('path')!;
    const icon = iconPaths[value?.status ?? send.icon];
    if (path.getAttribute('d') !== icon) path.setAttribute('d', icon);
  }

  remove(): void {
    const parent = this.element.parentElement;
    this.element.remove();
    if (parent && !parent.querySelector('.ctrlem-media-actions')) parent.classList.remove('ctrlem-media-host');
  }

  private icon(className: string, label: string, icon: keyof typeof iconPaths): HTMLButtonElement {
    const button = this.document.createElement('button');
    button.type = 'button'; button.className = className;
    const svg = this.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [name, value] of Object.entries({viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none',
      stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linejoin': 'round', 'aria-hidden': 'true'})) svg.setAttribute(name, value);
    const path = this.document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', iconPaths[icon]); svg.append(path); button.append(svg);
    button.title = label; button.setAttribute('aria-label', label);
    for (const event of ['pointerdown', 'mousedown', 'touchstart']) button.addEventListener(event, stop, true);
    return button;
  }
}

function stop(event: Event): void { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); }

function sameChildren(element: HTMLElement, children: HTMLElement[]): boolean {
  return element.childElementCount === children.length && children.every((child, index) => element.children[index] === child);
}
