/** Single-owner popover: one dialog at a time, dismissed by Escape or an outside press, focus returned to its anchor. */
import { placePanel } from './panel-placement';

export class MediaPopoverHost {
  private panel?: HTMLElement;
  private anchor?: HTMLElement;
  private readonly observer: MutationObserver;
  private cleanup?: () => void;
  constructor(private readonly document: Document) {
    this.observer = new document.defaultView!.MutationObserver(() => this.position());
  }

  show(anchor: HTMLElement, title: string, className: string): HTMLElement {
    this.dismiss();
    const document = this.document;
    const panel = document.createElement('section');
    panel.className = `ctrlem-popover ${className}`;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', title);
    panel.innerHTML = '<header><strong></strong><button data-close type="button" aria-label="Close">×</button></header>';
    panel.querySelector('strong')!.textContent = title;
    panel.querySelector('[data-close]')!.addEventListener('click', () => this.dismiss());
    panel.addEventListener('pointerdown', event => event.stopPropagation());
    document.body.append(panel);
    this.panel = panel; this.anchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    this.observer.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    this.position();
    document.addEventListener('pointerdown', this.outside, true);
    document.addEventListener('keydown', this.escape, true);
    document.defaultView!.addEventListener('scroll', this.reposition, true);
    document.defaultView!.addEventListener('resize', this.reposition);
    return panel;
  }

  bindCleanup(cleanup: () => void): void { this.cleanup = cleanup; }
  get isOpen(): boolean { return this.panel !== undefined; }

  position(): void {
    if (!this.panel || !this.anchor) return;
    if (!this.anchor.isConnected) return this.dismiss();
    const view = this.document.defaultView!;
    const placed = placePanel(this.anchor.getBoundingClientRect(), this.panel.getBoundingClientRect(), { width: view.innerWidth, height: view.innerHeight });
    this.panel.style.left = `${placed.left}px`; this.panel.style.top = `${placed.top}px`;
  }

  dismiss(): void {
    if (!this.panel) return;
    const anchor = this.anchor;
    const focusInside = this.panel.contains(this.document.activeElement as Node);
    anchor?.removeAttribute('aria-expanded');
    this.cleanup?.(); this.cleanup = undefined;
    this.observer.disconnect();
    this.panel.remove();
    this.panel = undefined; this.anchor = undefined;
    this.document.removeEventListener('pointerdown', this.outside, true);
    this.document.removeEventListener('keydown', this.escape, true);
    this.document.defaultView!.removeEventListener('scroll', this.reposition, true);
    this.document.defaultView!.removeEventListener('resize', this.reposition);
    if ((focusInside || this.document.activeElement === this.document.body) && anchor?.isConnected) anchor.focus();
  }

  private readonly outside = (event: Event) => {
    if (!this.panel?.contains(event.target as Node) && !this.anchor?.contains(event.target as Node)) this.dismiss();
  };
  private readonly escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && this.panel) this.dismiss(); };
  private readonly reposition = () => this.position();
}

