import { DiscordMediaSource } from '../adapters/discord-media-source';
import { HtmlMediaSource } from '../adapters/html-media-source';
import type { MediaSendPort } from '../ports/media-send-port';
import { MediaActionBar } from './media-action-bar';

export class MediaController {
  private readonly discord = new DiscordMediaSource();
  private readonly generic = new HtmlMediaSource();
  private readonly persistent = new Map<string, MediaActionBar>();
  private hover?: MediaActionBar;
  private observer?: MutationObserver;
  private scheduled = false;

  constructor(private readonly document: Document, private readonly sender: MediaSendPort) {}

  start(): void {
    if (this.discord.matches(this.document)) {
      this.reconcileDiscord();
      this.observer = new this.document.defaultView!.MutationObserver(() => this.scheduleDiscord());
      this.observer.observe(this.document.body, { childList: true, subtree: true });
      return;
    }
    this.document.addEventListener('pointerover', this.hoverMedia, true);
    this.document.addEventListener('focusin', this.hoverMedia, true);
    this.document.defaultView!.addEventListener('scroll', this.hideHover, true);
  }

  private readonly hoverMedia = (event: Event) => {
    if (!(event.target instanceof this.document.defaultView!.Element) || this.hover?.element.contains(event.target)) return;
    const target = this.generic.resolve(event.target);
    if (!target || !this.hover) return this.hideHover();
    if (!this.hover || this.hover.element.dataset.kind !== target.resource.kind) {
      this.hover?.remove();
      this.hover = new MediaActionBar(this.document, this.sender, target.resource);
      this.hover.element.dataset.kind = target.resource.kind;
      this.hover.element.classList.add('ctrlem-media-actions-floating');
    } else this.hover.set(target.resource);
    const rect = target.element.getBoundingClientRect();
    const window = this.document.defaultView!;
    this.hover.element.style.left = `${Math.min(window.innerWidth, Math.max(0, rect.right))}px`;
    this.hover.element.style.top = `${Math.min(window.innerHeight, Math.max(0, rect.bottom))}px`;
    if (!this.hover.element.isConnected) this.document.body.append(this.hover.element);
  };
  private readonly hideHover = () => this.hover?.element.remove();

  private scheduleDiscord(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.document.defaultView!.requestAnimationFrame(() => { this.scheduled = false; this.reconcileDiscord(); });
  }

  reconcileDiscord(): void {
    const found = new Set<string>();
    for (const target of this.discord.scan(this.document)) {
      found.add(target.resource.id);
      let bar = this.persistent.get(target.resource.id);
      if (!bar) { bar = new MediaActionBar(this.document, this.sender, target.resource); this.persistent.set(target.resource.id, bar); }
      bar.set(target.resource);
      target.element.classList.add('ctrlem-media-host');
      if (bar.element.parentElement !== target.element) {
        const previous = bar.element.parentElement; target.element.append(bar.element);
        if (previous && !previous.querySelector('.ctrlem-media-actions')) previous.classList.remove('ctrlem-media-host');
      }
    }
    for (const [id, bar] of this.persistent) if (!found.has(id)) { bar.remove(); this.persistent.delete(id); }
  }

  dispose(): void {
    this.observer?.disconnect();
    this.document.removeEventListener('pointerover', this.hoverMedia, true);
    this.document.removeEventListener('focusin', this.hoverMedia, true);
    this.document.defaultView!.removeEventListener('scroll', this.hideHover, true);
    this.hover?.remove(); for (const bar of this.persistent.values()) bar.remove(); this.persistent.clear();
  }
}
