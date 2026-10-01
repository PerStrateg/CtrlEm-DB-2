import type { MediaAttachmentSourcePort, MediaSourcePort } from '../ports/media-source-port';
import type { MediaSendPort } from '../ports/media-send-port';
import type { MediaSettingsPort } from '../ports/media-settings-port';
import type { MediaLibraryPort } from '../ports/media-library-port';
import type { MediaAction, MediaResource } from '../domain/media-resource';
import { MediaActionBar } from './media-action-bar';
import { mountInfoTips } from '../../ui/info-tip';
import { MediaPopoverHost } from './media-popover';
import { MediaPreferencesStore } from './media-preferences';
import { MediaRecipientsPopover } from './media-recipients-popover';
import { MediaSavePopover } from './media-save-popover';
import { mediaActions } from '../domain/media-resource';
import { mediaSendIdentity, mediaSendFeedbackMs, type MediaSendFeedback } from '../domain/media-send-feedback';

interface MountedMedia {
  key: string;
  root: HTMLElement;
  element: HTMLElement;
  bar: MediaActionBar;
}
const toastDurationMs = 2200, closeAnimationMs = 140;

/** One page owner: mounted bars, quick send, the single popover, and page-wide composer preferences. */
export class MediaController {
  private readonly mounted = new Map<string, MountedMedia>();
  private hover?: MediaActionBar;
  private observer?: MutationObserver;
  private scheduled = false;
  private readonly pendingRoots = new Set<HTMLElement>();
  private readonly popover: MediaPopoverHost;
  private readonly preferences: MediaPreferencesStore;
  private settingsPopover?: MediaRecipientsPopover;
  private savePopover?: MediaSavePopover;
  private readonly feedback = new Map<string, { value: MediaSendFeedback; timer?: number }>();
  private disposed = false;
  private stopInfoTips?: () => void;

  constructor(private readonly document: Document, private readonly sender: MediaSendPort,
    private readonly settings: MediaSettingsPort, private readonly library: MediaLibraryPort,
    private readonly attachments: MediaAttachmentSourcePort, private readonly generic: MediaSourcePort) {
    this.preferences = new MediaPreferencesStore(settings, () => this.reflectRecipients());
    this.popover = new MediaPopoverHost(document);
  }

  start(): void {
    this.stopInfoTips = mountInfoTips(this.document);
    void this.preferences.load().catch(() => { if (!this.disposed) this.toast('Couldn’t load recipients. Reload to retry.', true); });
    if (!this.attachments.appliesTo(this.document)) {
      this.document.addEventListener('pointerover', this.hoverMedia, true);
      this.document.addEventListener('focusin', this.hoverMedia, true);
      this.document.defaultView!.addEventListener('scroll', this.hideHover, true);
      return;
    }
    for (const root of this.attachments.roots(this.document)) this.mount(root);
    this.observer = new this.document.defaultView!.MutationObserver(records => this.schedule(records));
    this.observer.observe(this.document.body, { childList: true, subtree: true });
  }

  private readonly hoverMedia = (event: Event) => {
    if (!(event.target instanceof this.document.defaultView!.Element) || this.hover?.element.contains(event.target) ||
      event.target.closest('.ctrlem-popover, .ctrlem-db-tooltip')) return;
    const target = this.generic.resolve(event.target);
    if (!target) return this.hideHover();
    if (!this.hover || this.hover.element.dataset.kind !== target.resource.kind) {
      this.hover?.remove();
      this.hover = this.createBar(target.resource);
      this.hover.element.dataset.kind = target.resource.kind;
      this.hover.element.classList.add('ctrlem-media-actions-floating');
    } else this.hover.set(target.resource);
    this.reflectBarFeedback(this.hover, target.resource);
    const rect = target.element.getBoundingClientRect();
    const window = this.document.defaultView!;
    this.hover.element.style.left = `${Math.min(window.innerWidth, Math.max(0, rect.right))}px`;
    this.hover.element.style.top = `${Math.min(window.innerHeight, Math.max(0, rect.bottom))}px`;
    if (!this.hover.element.isConnected) this.document.body.append(this.hover.element);
  };
  private readonly hideHover = () => { if (!this.popover.isOpen) this.hover?.element.remove(); };

  private schedule(records: MutationRecord[]): void {
    for (const root of this.attachments.rootsFor(records)) this.pendingRoots.add(root);
    if (this.scheduled) return;
    this.scheduled = true;
    this.document.defaultView!.requestAnimationFrame(() => {
      this.scheduled = false;
      const roots = [...this.pendingRoots]; this.pendingRoots.clear();
      this.reconcileRoots(roots);
    });
  }

  /** Reconciles only the attachment roots that changed, plus roots that lost their bar with the frame. */
  reconcile(records: MutationRecord[]): void {
    this.reconcileRoots(this.attachments.rootsFor(records));
  }
  private reconcileRoots(changed: HTMLElement[]): void {
    const roots = new Set(changed);
    for (const entry of this.mounted.values()) if (!entry.bar.element.isConnected) roots.add(entry.root);
    for (const root of roots) this.mount(root);
  }

  private mount(root: HTMLElement): void {
    const found = new Set<string>();
    for (const target of root.isConnected ? this.attachments.targetsIn(root) : []) {
      found.add(target.key);
      const current = this.mounted.get(target.key);
      if (current?.element !== target.element) this.detach(current);
      const bar = current?.bar ?? this.createBar(target.resource);
      bar.set(target.resource);
      this.reflectBarFeedback(bar, target.resource);
      target.element.classList.add('ctrlem-media-host');
      if (bar.element.parentElement !== target.element) {
        const previous = bar.element.parentElement;
        target.element.append(bar.element);
        if (previous && !previous.querySelector('.ctrlem-media-actions')) previous.classList.remove('ctrlem-media-host');
      }
      this.mounted.set(target.key, { key: target.key, root, element: target.element, bar });
    }
    for (const entry of this.mounted.values()) {
      if (entry.root !== root || found.has(entry.key)) continue;
      this.detach(entry); this.mounted.delete(entry.key);
    }
  }

  private createBar(resource: MediaResource): MediaActionBar {
    const bar = new MediaActionBar(this.document, resource, {
      send: (action, current) => void this.quickSend(current, action),
      openSettings: anchor => this.openRecipients(anchor),
      openSave: (anchor, current) => this.openSave(anchor, current),
    });
    bar.applyRecipients(this.preferences.recipientNames);
    this.reflectBarFeedback(bar, resource);
    return bar;
  }

  private openRecipients(anchor: HTMLElement): void {
    const panel = this.popover.show(anchor, 'Recipients', 'ctrlem-recipients');
    this.settingsPopover = new MediaRecipientsPopover(this.document, panel,
      (kind, query) => this.settings.recipients(kind, query), this.preferences);
    this.popover.bindCleanup(() => { this.settingsPopover?.dispose(); this.settingsPopover = undefined; });
    panel.querySelector<HTMLButtonElement>('[data-disclosure]')!.focus();
  }

  private openSave(anchor: HTMLElement, resource: MediaResource): void {
    const panel = this.popover.show(anchor, 'Save to library', 'ctrlem-save');
    this.savePopover = new MediaSavePopover(this.document, panel, this.library, this.preferences);
    this.popover.bindCleanup(() => { this.savePopover = undefined; });
    void this.savePopover.open(resource);
    panel.querySelector<HTMLButtonElement>('[data-close]')!.focus();
  }

  /** Quick send uses one deterministic snapshot of the resource and the persisted common recipients. */
  private async quickSend(resource: MediaResource, action: MediaAction): Promise<void> {
    const intent = { resource: { ...resource }, action };
    const targets = this.preferences.current?.selectedRecipients.map(recipient => ({ ...recipient }));
    if (!targets?.length || this.disposed) return;
    const key = mediaSendIdentity(resource, action, targets);
    if (this.feedback.get(key)?.value.status === 'sending') return;
    this.setFeedback(key, { status: 'sending', message: 'Sending…' });
    try {
      await this.preferences.flush();
      if (this.disposed) return;
      const result = await this.sender.send(intent, targets);
      const message = result.failed ? `Sent ${result.sent}, failed ${result.failed}` : `Sent to ${result.sent}`;
      this.setFeedback(key, { status: result.failed ? 'failed' : 'sent', message });
      this.toast(message, result.failed > 0);
    } catch (error) {
      this.setFeedback(key, { status: 'failed', message: 'Couldn’t send. Retry.' });
      this.toast(error instanceof Error ? error.message : 'Couldn’t send.', true);
    }
  }

  private setFeedback(key: string, value: MediaSendFeedback): void {
    if (this.disposed) return;
    this.document.defaultView!.clearTimeout(this.feedback.get(key)?.timer);
    const entry: { value: MediaSendFeedback; timer?: number } = { value };
    this.feedback.set(key, entry);
    if (value.status !== 'sending') entry.timer = this.document.defaultView!.setTimeout(() => {
      this.feedback.delete(key); this.reflectFeedback();
    }, mediaSendFeedbackMs);
    this.reflectFeedback();
  }

  private reflectBarFeedback(bar: MediaActionBar, resource: MediaResource): void {
    const recipients = this.preferences.current?.selectedRecipients ?? [];
    for (const action of mediaActions(resource.kind)) {
      bar.setFeedback(action, this.feedback.get(mediaSendIdentity(resource, action, recipients))?.value);
    }
  }

  private reflectFeedback(): void {
    for (const entry of this.mounted.values()) this.reflectBarFeedback(entry.bar, entry.bar.currentResource);
    if (this.hover) this.reflectBarFeedback(this.hover, this.hover.currentResource);
  }

  private reflectRecipients(): void {
    const names = this.preferences.recipientNames;
    for (const entry of this.mounted.values()) entry.bar.applyRecipients(names);
    this.hover?.applyRecipients(names);
    this.reflectFeedback();
    this.settingsPopover?.refresh();
    this.savePopover?.refresh();
  }

  private detach(entry: MountedMedia | undefined): void {
    if (!entry) return;
    entry.element.classList.remove('ctrlem-media-host');
    entry.bar.remove();
  }

  private toast(message: string, error = false): void {
    if (this.disposed) return;
    const toast = this.document.createElement('div');
    toast.className = `ctrlem-toast${error ? ' error' : ''}`;
    toast.textContent = message;
    toast.setAttribute('role', 'status');
    this.document.body.append(toast);
    this.document.defaultView!.setTimeout(() => {
      toast.classList.add('closing');
      this.document.defaultView!.setTimeout(() => toast.remove(), closeAnimationMs);
    }, toastDurationMs);
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.feedback.values()) this.document.defaultView!.clearTimeout(entry.timer);
    this.feedback.clear();
    this.preferences.dispose();
    this.stopInfoTips?.();
    this.observer?.disconnect();
    this.document.removeEventListener('pointerover', this.hoverMedia, true);
    this.document.removeEventListener('focusin', this.hoverMedia, true);
    this.document.defaultView!.removeEventListener('scroll', this.hideHover, true);
    this.popover.dismiss();
    this.settingsPopover = undefined; this.savePopover = undefined;
    this.hover?.remove();
    for (const entry of this.mounted.values()) this.detach(entry);
    this.mounted.clear();
  }
}
