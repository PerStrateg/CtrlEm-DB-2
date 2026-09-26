import { overlayFrameName, OVERLAY_IFRAME_ALLOW } from '../redgifs/overlay-frame';

export class RedgifsPanel {
  readonly launcher: HTMLSpanElement;
  readonly button: HTMLButtonElement;
  readonly element: HTMLElement;
  private readonly frame: HTMLIFrameElement;
  private readonly status: HTMLElement;
  constructor(doc: Document, actions: { toggle(): void; home(): void; reload(): void; close(): void }) {
    this.launcher = doc.createElement('span'); this.launcher.className = 'ctrlem-db-ui';
    this.button = doc.createElement('button'); this.button.type = 'button';
    this.button.className = 'ctrlem-db-button ctrlem-db-rg-button'; this.button.textContent = 'RG';
    this.button.setAttribute('aria-controls', 'ctrlem-db-redgifs');
    this.button.addEventListener('click', event => { event.stopPropagation(); actions.toggle(); });
    this.launcher.append(this.button);
    this.element = doc.createElement('section'); this.element.id = 'ctrlem-db-redgifs';
    this.element.className = 'ctrlem-db-ui ctrlem-db-redgifs'; this.element.setAttribute('aria-label', 'RedGifs');
    const bar = doc.createElement('div'); bar.className = 'ctrlem-db-rg-bar';
    const label = doc.createElement('strong'); label.textContent = 'RedGifs'; bar.append(label);
    for (const [label, action] of [['Home', actions.home], ['Reload', actions.reload], ['Close', actions.close]] as const) {
      const button = doc.createElement('button'); button.type = 'button'; button.textContent = label;
      button.addEventListener('click', action); bar.append(button);
    }
    this.frame = doc.createElement('iframe'); this.frame.name = overlayFrameName();
    this.frame.title = 'RedGifs video browser'; this.frame.allow = OVERLAY_IFRAME_ALLOW;
    this.status = doc.createElement('p'); this.status.setAttribute('role', 'status');
    this.element.append(bar, this.status, this.frame); this.render(false);
  }
  navigate(url: string): void { this.frame.src = url; }
  error(message: string): void { this.status.textContent = message; }
  render(open: boolean): void {
    this.button.setAttribute('aria-expanded', String(open));
    this.button.setAttribute('aria-label', open ? 'Close RedGifs' : 'Open RedGifs');
  }
  stop(): void { this.frame.src = 'about:blank'; this.element.remove(); this.render(false); }
}
