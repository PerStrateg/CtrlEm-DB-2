import type { MediaSettingsPort } from '../ports/media-settings-port';
import type { MediaSendPort } from '../ports/media-send-port';
import type { MediaRecipient } from '../domain/media-settings';
import type { MediaComposerPreferences } from '../domain/media-composer';
import { mediaActions, type MediaAction, type MediaResource } from '../domain/media-resource';
import type { MediaLibraryPort } from '../ports/media-library-port';

const viewportMargin = 10, anchorGap = 8, searchDelayMs = 250, closeAnimationMs = 140;
export function placeComposer(anchor: Pick<DOMRect, 'top' | 'right' | 'bottom'>,
  panel: Pick<DOMRect, 'width' | 'height'>, viewport: { width: number; height: number }): { left: number; top: number } {
  const left = Math.min(viewport.width - panel.width - viewportMargin, Math.max(viewportMargin, anchor.right - panel.width));
  const below = anchor.bottom + anchorGap, above = anchor.top - panel.height - anchorGap;
  return { left: Math.max(viewportMargin, left), top: below + panel.height <= viewport.height - viewportMargin ? below : Math.max(viewportMargin, above) };
}

export class MediaComposer {
  private panel?: HTMLElement; private anchor?: HTMLElement; private resource?: MediaResource;
  private preferences?: MediaComposerPreferences; private kind: MediaRecipient['kind'] = 'group';
  private query = ''; private searchTimer?: number; private closeTimer?: number; private closing = false;
  private revision = 0; private searchSequence = 0; private saveTail: Promise<void> = Promise.resolve();
  constructor(private readonly document: Document, private readonly settings: MediaSettingsPort,
    private readonly sender: MediaSendPort, private readonly library: MediaLibraryPort, private readonly showWallpaper: boolean) {}

  async open(resource: MediaResource, anchor: HTMLElement): Promise<void> {
    this.closeNow(); this.revision++; const revision = this.revision;
    this.resource = resource; this.anchor = anchor; this.kind = 'group'; this.query = '';
    const panel = this.document.createElement('section'); panel.className = 'ctrlem-composer'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Send with CtrlEm');
    panel.innerHTML = `<header><strong>Send with CtrlEm</strong><button data-close type="button" aria-label="Close">×</button></header><div class="ctrlem-composer-chips" data-selected></div><nav><button data-kind="group" class="active" type="button">Groups</button><button data-kind="user" type="button">People</button></nav><input data-search type="search" placeholder="Search" autocomplete="off"><div class="ctrlem-composer-list" data-list><p>Loading…</p></div><footer data-actions></footer><p class="ctrlem-composer-status" data-status role="status"></p>`;
    this.panel = panel; this.document.body.append(panel); this.position(); this.bind();
    try {
      const preferences = await this.settings.loadComposer();
      if (!this.current(revision)) return;
      this.preferences = preferences;
      this.renderSelected(); await Promise.all([this.search(), this.loadCategories(revision)]); this.position();
    }
    catch (error) { if (this.current(revision)) this.status(error instanceof Error ? error.message : 'Couldn’t load CtrlEm.', true); }
  }
  private current(revision: number): boolean { return revision === this.revision && this.panel !== undefined; }
  dispose(): void { this.closeNow(); }
  private bind(): void {
    this.panel!.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => this.close();
    this.panel!.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(button => button.onclick = () => { this.kind = button.dataset.kind as MediaRecipient['kind']; this.panel!.querySelectorAll('[data-kind]').forEach(item => item.classList.toggle('active', item === button)); void this.search(); });
    const search = this.panel!.querySelector<HTMLInputElement>('[data-search]')!;
    search.oninput = () => { this.query = search.value.trim(); this.document.defaultView!.clearTimeout(this.searchTimer); this.searchTimer = this.document.defaultView!.setTimeout(() => void this.search(), searchDelayMs); };
    this.panel!.addEventListener('pointerdown', event => event.stopPropagation()); this.document.addEventListener('pointerdown', this.outside, true); this.document.addEventListener('keydown', this.keydown, true);
    this.document.defaultView!.addEventListener('scroll', this.scrolled, true); this.document.defaultView!.addEventListener('resize', this.resized); this.renderActions();
  }
  private async search(): Promise<void> {
    if (!this.panel) return; const revision = this.revision, sequence = ++this.searchSequence; const list = this.panel.querySelector('[data-list]')!; list.textContent = 'Loading…';
    try { const recipients = await this.settings.recipients(this.kind, this.query); if (!this.current(revision) || sequence !== this.searchSequence) return; list.replaceChildren(...recipients.map(recipient => this.recipientRow(recipient))); if (!recipients.length) list.textContent = 'Nothing found'; }
    catch { if (this.current(revision) && sequence === this.searchSequence) list.textContent = 'Couldn’t load recipients.'; }
  }
  private recipientRow(recipient: MediaRecipient): HTMLButtonElement {
    const selected = this.preferences?.selectedRecipients.some(item => item.receiver === recipient.receiver); const button = this.document.createElement('button');
    button.type = 'button'; button.className = 'ctrlem-composer-recipient'; button.setAttribute('aria-pressed', String(Boolean(selected))); button.textContent = `${selected ? '✓' : ''} ${recipient.label}`; button.onclick = () => void this.toggle(recipient); return button;
  }
  private toggle(recipient: MediaRecipient): void {
    if (!this.preferences) return; const selected = this.preferences.selectedRecipients.some(item => item.receiver === recipient.receiver);
    const selectedRecipients = selected ? this.preferences.selectedRecipients.filter(item => item.receiver !== recipient.receiver) : [...this.preferences.selectedRecipients, recipient];
    this.commit({ ...this.preferences, selectedRecipients });
  }
  /** Writes are serialized and applied optimistically, so a second click cannot be computed from a stale snapshot. */
  private commit(preferences: MediaComposerPreferences): void {
    const revision = this.revision; this.preferences = preferences; this.renderSelected();
    this.saveTail = this.saveTail.then(async () => {
      try { const saved = await this.settings.saveComposer(preferences); if (this.current(revision)) { this.preferences = saved; this.renderSelected(); } }
      catch (error) { if (this.current(revision)) { this.status(error instanceof Error ? error.message : 'Couldn’t save recipients.', true); await this.search(); } }
    });
  }
  private renderSelected(): void {
    if (!this.panel || !this.preferences) return; const selected = this.panel.querySelector('[data-selected]')!;
    selected.replaceChildren(...this.preferences.selectedRecipients.map(recipient => { const chip = this.document.createElement('button'); chip.type = 'button'; chip.className = 'ctrlem-composer-chip'; chip.textContent = `${recipient.kind === 'group' ? 'G' : 'P'} · ${recipient.label} ×`; chip.onclick = () => this.toggle(recipient); return chip; }));
    if (!this.preferences.selectedRecipients.length) selected.textContent = 'Choose recipients';
  }
  private renderActions(): void {
    const actions = mediaActions(this.resource!.kind).filter(action => action !== 'wallpaper' || this.showWallpaper);
    const buttons = actions.map(action => { const button = this.document.createElement('button'); button.type = 'button'; button.className = 'ctrlem-composer-primary'; button.textContent = action === 'popup-image' ? 'Send image' : action === 'wallpaper' ? 'Wallpaper' : 'Send video'; button.onclick = () => void this.send(action); return button; });
    const save = this.document.createElement('button'); save.type = 'button'; save.className = 'ctrlem-composer-secondary'; save.textContent = 'Save'; save.onclick = () => void this.save(); buttons.push(save);
    this.panel!.querySelector('[data-actions]')!.replaceChildren(...buttons);
  }
  private async loadCategories(revision: number): Promise<void> {
    if (!this.panel || !this.resource || !this.preferences) return; const kind = this.resource.kind; const categories = await this.library.categories(kind);
    if (!this.current(revision)) return;
    const select = this.document.createElement('select'); select.className = 'ctrlem-composer-category'; select.setAttribute('aria-label', 'Library category');
    const placeholder = this.document.createElement('option'); placeholder.value = ''; placeholder.textContent = categories.length ? 'Choose category' : 'Create a category in CtrlEm DB'; select.append(placeholder);
    for (const category of categories) { const option = this.document.createElement('option'); option.value = category.id; option.textContent = category.name; select.append(option); }
    const key = kind === 'image' ? 'imageCategoryId' : 'videoCategoryId'; select.value = this.preferences[key] ?? '';
    select.onchange = () => { if (this.preferences) this.commit({ ...this.preferences, [key]: select.value || undefined }); };
    this.panel.querySelector('[data-actions]')!.before(select);
  }
  private async save(): Promise<void> {
    if (!this.resource || !this.preferences) return; const key = this.resource.kind === 'image' ? 'imageCategoryId' : 'videoCategoryId'; const categoryId = this.preferences[key];
    if (!categoryId) return this.status('Choose a library category.', true); const revision = this.revision; this.busy(true);
    try { await this.library.save(this.resource.url, this.resource.kind, categoryId, progress => { if (this.current(revision)) this.status(progress.stage === 'download' ? 'Downloading…' : progress.stage === 'upload' ? 'Uploading…' : 'Saving…'); }); if (!this.current(revision)) return; this.toast('Saved to library'); this.close(); }
    catch (error) { if (this.current(revision)) { this.status(error instanceof Error ? error.message : 'Couldn’t save.', true); this.busy(false); } }
  }
  private async send(action: MediaAction): Promise<void> {
    if (!this.resource || !this.preferences?.selectedRecipients.length) return this.status('Choose recipients.', true);
    const revision = this.revision; this.busy(true); this.status('Adding to queue…');
    const recipients = this.preferences.selectedRecipients;
    try { const result = await this.sender.send({ resource: this.resource, action }, recipients); if (!this.current(revision)) return; this.toast(result.failed ? `Sent ${result.sent}, failed ${result.failed}` : `Sent to ${result.sent}`); this.close(); }
    catch (error) { if (this.current(revision)) { this.status(error instanceof Error ? error.message : 'Couldn’t send.', true); this.busy(false); } }
  }
  private position(): void {
    if (!this.panel || !this.anchor) return; const anchor = this.anchor.getBoundingClientRect(), panel = this.panel.getBoundingClientRect(), view = this.document.defaultView!;
    const placed = placeComposer(anchor, panel, { width: view.innerWidth, height: view.innerHeight });
    this.panel.style.left = `${placed.left}px`; this.panel.style.top = `${placed.top}px`;
  }
  private status(message: string, error = false): void { const status = this.panel?.querySelector('[data-status]'); if (status) { status.textContent = message; status.classList.toggle('error', error); } }
  private busy(value: boolean): void { this.panel?.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = value; }); }
  private toast(message: string): void { const toast = this.document.createElement('div'); toast.className = 'ctrlem-toast'; toast.textContent = message; this.document.body.append(toast); this.document.defaultView!.setTimeout(() => { toast.classList.add('closing'); this.document.defaultView!.setTimeout(() => toast.remove(), closeAnimationMs); }, 2200); }
  private readonly outside = (event: Event) => { if (!this.panel?.contains(event.target as Node) && !this.anchor?.contains(event.target as Node)) this.close(); };
  private readonly keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') this.close(); };
  private readonly scrolled = () => this.close(); private readonly resized = () => this.position();
  private close(): void { if (!this.panel || this.closing) return; this.closing = true; this.panel.classList.add('closing'); const revision = this.revision; this.closeTimer = this.document.defaultView!.setTimeout(() => { if (this.revision === revision) this.closeNow(); }, closeAnimationMs); }
  private closeNow(): void {
    this.document.defaultView!.clearTimeout(this.searchTimer); this.document.defaultView!.clearTimeout(this.closeTimer); this.revision++; this.searchSequence++;
    this.panel?.remove(); this.panel = undefined; this.anchor = undefined; this.resource = undefined; this.closing = false;
    this.document.removeEventListener('pointerdown', this.outside, true); this.document.removeEventListener('keydown', this.keydown, true);
    this.document.defaultView!.removeEventListener('scroll', this.scrolled, true); this.document.defaultView!.removeEventListener('resize', this.resized);
  }
}
