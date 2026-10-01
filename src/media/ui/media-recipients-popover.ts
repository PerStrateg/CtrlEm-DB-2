import type { MediaRecipient } from '../domain/media-settings';
import type { MediaPreferencesStore } from './media-preferences';
import { createInfoButton } from '../../ui/info-tip';

const searchDelayMs = 250;

/** Recipients only: chips with immediate removal, and a collapsed directory that costs no request until opened. */
export class MediaRecipientsPopover {
  private kind: MediaRecipient['kind'] = 'group';
  private query = '';
  private searchTimer?: number;
  private sequence = 0;
  private readonly chips: HTMLElement;
  private readonly disclosure: HTMLButtonElement;
  private readonly add: HTMLElement;
  private readonly status: HTMLElement;
  private readonly rows = new Map<HTMLButtonElement, MediaRecipient>();

  constructor(private readonly document: Document, private readonly panel: HTMLElement,
    private readonly recipients: (kind: MediaRecipient['kind'], query: string) => Promise<MediaRecipient[]>,
    private readonly store: MediaPreferencesStore) {
    panel.insertAdjacentHTML('beforeend', `<div class="ctrlem-popover-chips" data-chips></div>
      <button data-disclosure type="button" class="ctrlem-disclosure" aria-expanded="false" aria-controls="ctrlem-recipient-directory">Add recipients</button>
      <div id="ctrlem-recipient-directory" data-add hidden>
        <nav><button data-kind="group" class="active" type="button">Groups</button><button data-kind="user" type="button">People</button></nav>
        <input data-search type="search" placeholder="Search" autocomplete="off" aria-label="Search recipients">
        <div class="ctrlem-popover-list" data-list></div>
      </div>
      <p class="ctrlem-popover-status" data-status role="status"></p>`);
    this.chips = panel.querySelector('[data-chips]')!;
    this.add = panel.querySelector('[data-add]')!;
    this.disclosure = panel.querySelector('[data-disclosure]')!;
    this.status = panel.querySelector('[data-status]')!;
    panel.querySelector('header')!.append(createInfoButton(document, 'About recipients',
      'Quick sends on all sites use these recipients.'));
    this.disclosure.addEventListener('click', () => this.toggleDirectory());
    this.add.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(button => button.addEventListener('click', () => {
      this.kind = button.dataset.kind as MediaRecipient['kind'];
      this.add.querySelector<HTMLInputElement>('[data-search]')!.placeholder = this.kind === 'user' ? 'Name or code' : 'Search groups';
      this.add.querySelectorAll('[data-kind]').forEach(item => item.classList.toggle('active', item === button));
      void this.search();
    }));
    const search = this.add.querySelector<HTMLInputElement>('[data-search]')!;
    search.addEventListener('input', () => {
      this.query = search.value.trim();
      this.document.defaultView!.clearTimeout(this.searchTimer);
      this.searchTimer = this.document.defaultView!.setTimeout(() => void this.search(), searchDelayMs);
    });
    this.refresh();
  }

  dispose(): void { this.sequence++; this.document.defaultView!.clearTimeout(this.searchTimer); }

  refresh(): void {
    this.disclosure.disabled = !this.store.current;
    if (!this.store.current) this.status.textContent = 'Recipients not loaded. Reload to retry.';
    else if (this.status.textContent === 'Recipients not loaded. Reload to retry.') this.status.textContent = '';
    this.renderChips();
    for (const [button, recipient] of this.rows) button.setAttribute('aria-pressed', String(this.isSelected(recipient)));
  }

  private toggleDirectory(): void {
    const open = this.add.hidden;
    this.add.hidden = !open;
    this.disclosure.setAttribute('aria-expanded', String(open));
    this.document.defaultView!.clearTimeout(this.searchTimer);
    this.sequence++;
    if (open) void this.search();
  }

  private async search(): Promise<void> {
    if (!this.panel.isConnected || this.add.hidden) return;
    const list = this.add.querySelector('[data-list]')!;
    const sequence = ++this.sequence;
    this.rows.clear();
    list.textContent = 'Loading…';
    try {
      const found = await this.recipients(this.kind, this.query);
      if (!this.panel.isConnected || sequence !== this.sequence) return;
      list.replaceChildren(...found.map(recipient => this.row(recipient)));
      if (!found.length) list.textContent = 'Nothing found';
    } catch {
      if (sequence === this.sequence) list.textContent = 'Couldn’t load recipients.';
    }
  }

  private row(recipient: MediaRecipient): HTMLButtonElement {
    const button = this.document.createElement('button');
    button.type = 'button'; button.className = 'ctrlem-popover-recipient'; button.textContent = recipient.kind === 'user' ? `${recipient.label} · ${recipient.receiver.toUpperCase()}` : recipient.label;
    button.setAttribute('aria-pressed', String(this.isSelected(recipient)));
    this.rows.set(button, recipient);
    button.addEventListener('click', () => this.toggle(recipient));
    return button;
  }

  private isSelected(recipient: MediaRecipient): boolean {
    return Boolean(this.store.current?.selectedRecipients.some(item => item.receiver === recipient.receiver));
  }

  private toggle(recipient: MediaRecipient): void {
    const current = this.store.current;
    if (!current) return;
    const selected = this.isSelected(recipient);
    const selectedRecipients = selected
      ? current.selectedRecipients.filter(item => item.receiver !== recipient.receiver)
      : [...current.selectedRecipients, recipient];
    void this.store.commit({ ...current, selectedRecipients }).catch(error => this.fail(error));
    this.refresh();
  }

  private fail(error: unknown): void {
    this.status.textContent = error instanceof Error ? error.message : 'Couldn’t save recipients.';
  }

  private renderChips(): void {
    const selected = this.store.current?.selectedRecipients ?? [];
    const nodes: HTMLElement[] = selected.map(recipient => {
      const chip = this.document.createElement('button');
      chip.type = 'button'; chip.className = 'ctrlem-popover-chip';
      chip.textContent = `${recipient.label} ×`;
      chip.setAttribute('aria-label', `Remove ${recipient.label}`);
      chip.addEventListener('click', () => this.toggle(recipient));
      return chip;
    });
    if (!selected.length) {
      const empty = this.document.createElement('span');
      empty.className = 'ctrlem-popover-empty'; empty.textContent = 'No recipients yet';
      nodes.push(empty);
    }
    this.chips.replaceChildren(...nodes);
  }
}

