import type { MediaAction, MediaResource } from '../domain/media-resource';
import type { MediaSendPort } from '../ports/media-send-port';

const successVisibleMs = 1_400;
const presentation: Record<MediaAction, { symbol: string; idleLabel: string; busyLabel: string; successLabel: string }> = {
  'popup-image': { symbol: 'I', idleLabel: 'Send image to CtrlEm', busyLabel: 'Sending image to CtrlEm', successLabel: 'Image queued for CtrlEm' },
  wallpaper: { symbol: 'W', idleLabel: 'Set as wallpaper with CtrlEm', busyLabel: 'Sending wallpaper to CtrlEm', successLabel: 'Wallpaper queued for CtrlEm' },
  'video-overlay': { symbol: 'V', idleLabel: 'Send video to CtrlEm', busyLabel: 'Sending video to CtrlEm', successLabel: 'Video queued for CtrlEm' },
};

export class MediaSendButton {
  readonly element: HTMLButtonElement;
  private resource?: MediaResource;
  private resetTimer?: number;

  constructor(document: Document, private readonly action: MediaAction, private readonly sender: MediaSendPort) {
    this.element = document.createElement('button');
    this.element.type = 'button'; this.element.className = `ctrlem-media-send ctrlem-media-send-${action}`;
    this.idle();
    for (const event of ['pointerdown', 'mousedown', 'touchstart']) this.element.addEventListener(event, stop, true);
    this.element.addEventListener('click', event => { stop(event); void this.send(); }, true);
  }

  set(resource: MediaResource): void {
    const changed = this.resource?.id !== resource.id;
    this.resource = resource;
    if (changed) this.idle();
  }

  private async send(): Promise<void> {
    if (!this.resource || this.element.disabled) return;
    const copy = presentation[this.action];
    this.element.disabled = true; this.render('…', copy.busyLabel);
    try {
      await this.sender.send({ resource: this.resource, action: this.action });
      this.render('✓', copy.successLabel);
      this.resetTimer = this.element.ownerDocument.defaultView!.setTimeout(() => this.idle(), successVisibleMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Couldn’t send to CtrlEm.';
      this.element.disabled = false; this.render('!', `${message} Click to retry.`);
    }
  }

  private idle(): void {
    if (this.resetTimer) this.element.ownerDocument.defaultView!.clearTimeout(this.resetTimer);
    const copy = presentation[this.action];
    this.resetTimer = undefined; this.element.disabled = false; this.render(copy.symbol, copy.idleLabel);
  }

  private render(text: string, label: string): void { this.element.textContent = text; this.element.setAttribute('aria-label', label); this.element.title = label; }
  remove(): void {
    if (this.resetTimer) this.element.ownerDocument.defaultView!.clearTimeout(this.resetTimer);
    const parent = this.element.parentElement; this.element.remove();
    if (parent && !parent.querySelector('.ctrlem-media-actions')) parent.classList.remove('ctrlem-media-host');
  }
}

function stop(event: Event): void { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); }
