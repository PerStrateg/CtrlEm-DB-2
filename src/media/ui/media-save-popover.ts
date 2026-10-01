import type { MediaCategory, MediaLibraryPort, MediaLibraryProgress } from '../ports/media-library-port';
import type { MediaKind, MediaResource } from '../domain/media-resource';
import type { MediaPreferencesStore } from './media-preferences';
import { createInfoButton } from '../../ui/info-tip';

const categoryKey = (kind: MediaKind) => kind === 'image' ? 'imageCategoryId' as const : 'videoCategoryId' as const;
const stageLabel: Record<MediaLibraryProgress['stage'], string> = {
  download: 'Downloading…', upload: 'Uploading…', save: 'Saving…',
};

/** Library only: a category per kind, remembered in composer preferences, and an explicit save. Never sends. */
export class MediaSavePopover {
  private readonly select: HTMLSelectElement;
  private readonly save: HTMLButtonElement;
  private readonly status: HTMLElement;
  private resource?: MediaResource;
  private busy = false;

  constructor(private readonly document: Document, private readonly panel: HTMLElement,
    private readonly library: MediaLibraryPort, private readonly store: MediaPreferencesStore) {
    panel.insertAdjacentHTML('beforeend', `<label class="ctrlem-popover-field">Category
        <select data-category aria-label="Library category"></select></label>
      <button data-save type="button" class="ctrlem-popover-primary">Save</button>
      <p class="ctrlem-popover-status" data-status role="status"></p>`);
    this.select = panel.querySelector('[data-category]')!;
    this.save = panel.querySelector('[data-save]')!;
    this.status = panel.querySelector('[data-status]')!;
    this.select.disabled = this.save.disabled = true;
    panel.querySelector('header')!.append(createInfoButton(document, 'About the library',
      'Saving copies this file into your CtrlEm library. Nothing is sent to recipients.'));
    this.select.addEventListener('change', () => this.remember(this.select.value || undefined));
    this.save.addEventListener('click', () => void this.saveToLibrary());
  }

  /** Every open reads current categories, including changes made in CtrlEm DB. */
  async open(resource: MediaResource): Promise<void> {
    this.resource = resource;
    const kind = resource.kind;
    this.select.value = this.remembered(kind) ?? '';
    this.say('');
    this.say('Loading…');
    try {
      const categories = await this.library.categories(kind);
      if (!this.panel.isConnected) return;
      this.render(categories); this.select.disabled = false; this.refresh(); this.say('');
    }
    catch (error) { this.say(error instanceof Error ? error.message : 'Couldn’t load categories.', true); }
  }

  private render(categories: MediaCategory[]): void {
    const empty = this.document.createElement('option');
    empty.value = ''; empty.textContent = categories.length ? 'Choose category' : 'Create a category in CtrlEm DB';
    this.select.replaceChildren(empty, ...categories.map(category => {
      const option = this.document.createElement('option');
      option.value = category.id; option.textContent = category.name;
      return option;
    }));
    this.refresh();
  }

  refresh(): void {
    if (!this.resource || this.busy) return;
    this.select.value = this.remembered(this.resource.kind) ?? '';
    this.save.disabled = this.select.disabled || !this.select.value;
  }

  private remembered(kind: MediaKind): string | undefined { return this.store.current?.[categoryKey(kind)]; }

  private remember(categoryId: string | undefined): void {
    const current = this.store.current;
    if (!current) return;
    void this.store.commit({ ...current, [categoryKey(this.resource!.kind)]: categoryId })
      .catch(() => this.say('Couldn’t remember the category.', true));
    this.save.disabled = !categoryId;
  }

  private async saveToLibrary(): Promise<void> {
    if (this.busy || !this.resource) return;
    const categoryId = this.select.value;
    if (!categoryId) return this.say('Choose a category.', true);
    this.busy = true; this.save.disabled = this.select.disabled = true;
    try {
      const resource = this.resource;
      await this.library.save(resource.url, resource.kind, categoryId, progress => this.say(stageLabel[progress.stage]));
      this.say('Saved to library');
    } catch (error) {
      this.say(error instanceof Error ? error.message : 'Couldn’t save.', true);
    } finally { this.busy = false; this.select.disabled = false; this.refresh(); }
  }

  private say(message: string, error = false): void {
    if (!this.panel.isConnected) return;
    this.status.textContent = message;
    this.status.classList.toggle('error', error);
  }
}
