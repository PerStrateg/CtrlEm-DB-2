import { createInfoButton } from './info-tip';
import type { Item } from '../model/library';
import type { PickerSelection } from '../shared/picker-protocol';
import type { MediaType } from './media-preview';
import { VisibleImages } from '../images/visible-images';
import type { ImageLoader } from '../images/image-cache-client';

export interface PickerCategory { id: string; name: string; count: number }
export interface PickerViewState {
  categories: PickerCategory[]; items: Item[]; selection: PickerSelection;
  loading: boolean; loadError: boolean; error?: string;
  image: boolean; previews: boolean; previewBusy: boolean;
  canDeleteImages?: boolean; deleteBusy?: boolean; deleteError?: string;
  emptyMessage?: string;
  mediaType?: MediaType;
}
interface PickerActions {
  category(id: string): void;
  select(id: string): void;
  deleteImage(id: string): void;
  edit(create: boolean, initiator: HTMLElement): void;
  previews(enabled: boolean): void;
  retry(): void;
  preview(id: string, initiator: HTMLElement): void;
}

/** Keyed controls preserve row focus and list scroll on library updates. */
export class ContentPickerView {
  readonly element: HTMLElement;
  private readonly info: HTMLButtonElement;
  private readonly categories: HTMLSelectElement;
  private readonly items: HTMLElement;
  private readonly status: HTMLElement;
  private readonly retry: HTMLButtonElement;
  private readonly create: HTMLButtonElement;
  private readonly edit: HTMLButtonElement;
  private readonly previews: HTMLInputElement;
  private readonly rows = new Map<string, HTMLButtonElement>();
  private categoryId?: string;
  private images?: VisibleImages;

  constructor(private readonly document: Document, label: string, actions: PickerActions, private readonly imageLoader?: ImageLoader) {
    this.element = document.createElement('section');
    this.element.className = 'ctrlem-db-picker ctrlem-db-ui';
    this.element.setAttribute('aria-label', `${label} library`);
    this.element.innerHTML = `
      <div class="ctrlem-db-picker-tools">
        <select title="Category"><option value="" disabled hidden>Choose category</option></select>
        <button type="button" class="ctrlem-db-picker-tool" data-action="create" title="Create category" aria-label="Create category">+</button>
        <button type="button" class="ctrlem-db-picker-tool" data-action="edit" title="Edit category" aria-label="Edit category">✎</button>
        <label class="ctrlem-db-picker-previews" title="Show previews"><input type="checkbox" aria-label="Show previews"></label>
      </div>
      <p class="ctrlem-db-picker-status" role="status"></p>
      <p class="ctrlem-db-picker-delete-error" role="alert" hidden></p>
      <button type="button" data-action="retry" hidden>Retry</button>
      <div class="ctrlem-db-picker-items" role="group" aria-label="Entries"></div>`;
    this.info = createInfoButton(document, 'About this category', '');
    this.element.querySelector('.ctrlem-db-picker-tools')!.append(this.info);
    this.categories = this.element.querySelector('select')!;
    this.categories.setAttribute('aria-label', `${label} category`);
    this.items = this.element.querySelector('.ctrlem-db-picker-items')!;
    this.status = this.element.querySelector('.ctrlem-db-picker-status')!;
    this.retry = this.element.querySelector('[data-action=retry]')!;
    this.create = this.element.querySelector('[data-action=create]')!;
    this.edit = this.element.querySelector('[data-action=edit]')!;
    this.previews = this.element.querySelector('input')!;
    this.categories.addEventListener('change', () => actions.category(this.categories.value));
    this.create.addEventListener('click', () => actions.edit(true, this.create));
    this.edit.addEventListener('click', () => actions.edit(false, this.edit));
    this.retry.addEventListener('click', actions.retry);
    this.previews.addEventListener('change', () => actions.previews(this.previews.checked));
    this.items.addEventListener('click', event => {
      const preview = (event.target as Element).closest<HTMLButtonElement>('button[data-preview-id]');
      if (preview) { actions.preview(preview.dataset.previewId!, preview); return; }
      const remove = (event.target as Element).closest<HTMLButtonElement>('button[data-delete-id]');
      if (remove) { actions.deleteImage(remove.dataset.deleteId!); return; }
      const row = (event.target as Element).closest<HTMLButtonElement>('button[data-item-id]');
      if (row) actions.select(row.dataset.itemId!);
    });
  }

  render(state: PickerViewState): void {
    const deleteError = this.element.querySelector<HTMLElement>('.ctrlem-db-picker-delete-error')!;
    deleteError.textContent = state.deleteError ?? ''; deleteError.hidden = !state.deleteError;
    const options = new Map(Array.from(this.categories.options, option => [option.value, option]));
    const categoryIds = new Set(state.categories.map(category => category.id));
    for (const option of options.values()) if (option.value && !categoryIds.has(option.value)) option.remove();
    state.categories.forEach((category, index) => {
      const option = options.get(category.id) ?? this.document.createElement('option');
      option.value = category.id;
      const label = `${category.name} (${category.count})`;
      if (option.textContent !== label) option.textContent = label;
      if (this.categories.children[index + 1] !== option) this.categories.insertBefore(option, this.categories.children[index + 1] ?? null);
    });
    const selected = state.categories.find(category => category.id === state.selection.categoryId);
    const special = selected?.id === 'default' ? 'Images provided by CtrlEm. They are not saved in your library.'
      : selected?.name === 'Input' ? 'New items you send are saved here automatically.' : 'Choose an item to fill the command. Press Send when you are ready.';
    this.info.dataset.info = special + (state.mediaType ? ' Preview lets you view or play an item without sending it.' : '');
    this.categories.value = state.selection.categoryId ?? '';
    this.categories.title = this.categories.selectedOptions[0]?.textContent ?? 'Category';
    this.categories.disabled = state.loading || state.loadError || !state.categories.length;
    this.create.disabled = state.loading || state.loadError;
    this.edit.disabled = this.create.disabled || !state.selection.categoryId || state.selection.categoryId === 'default';
    this.previews.parentElement!.hidden = !state.image || !state.selection.categoryId || state.selection.categoryId === 'default';
    this.previews.checked = state.previews;
    this.previews.disabled = state.previewBusy;
    const status = state.loading ? 'Loading library…' : state.loadError ? 'Couldn’t load library. Retry.'
      : state.error ?? (!state.categories.length ? 'No categories yet.' : !state.selection.categoryId ? 'Choose a category or create one.' : !state.items.length ? state.emptyMessage ?? 'No items yet.' : '');
    if (this.status.textContent !== status) this.status.textContent = status;
    this.retry.hidden = !(state.loadError || state.error);
    this.items.classList.toggle('ctrlem-db-picker-media', Boolean(state.mediaType));
    this.items.classList.toggle('ctrlem-db-picker-grid', state.image);
    this.items.classList.toggle('ctrlem-db-picker-no-previews', state.image && !state.previews);
    const ids = new Set(state.items.map(item => item.id));
    for (const [id, row] of this.rows) if (!ids.has(id)) { this.images?.set(row); row.parentElement!.remove(); this.rows.delete(id); }
    if (state.image && state.previews) this.images ??= new VisibleImages(this.document, this.imageLoader);
    state.items.forEach((item, index) => {
      let row = this.rows.get(item.id);
      if (!row) {
        row = this.document.createElement('button'); row.type = 'button'; row.dataset.itemId = item.id;
        row.className = 'ctrlem-db-picker-select';
        const card = this.document.createElement('div'); card.className = 'ctrlem-db-picker-card'; card.append(row);
        const caption = this.document.createElement('span'); row.append(caption);
        this.rows.set(item.id, row);
      }
      const caption = row.querySelector('span')!;
      const label = item.label || item.value;
      if (caption.textContent !== label) caption.textContent = label;
      row.title = item.label ? `${item.label}\n${item.value}` : item.value;
      row.setAttribute('aria-label', label);
      row.setAttribute('aria-pressed', String(state.selection.itemId === item.id));
      this.images?.set(row, state.image && state.previews ? item.value : undefined);
      const card = row.parentElement!;
      let preview = card.querySelector<HTMLButtonElement>('[data-preview-id]');
      if (state.mediaType) {
        if (!preview) {
          preview = this.document.createElement('button'); preview.type = 'button';
          preview.className = 'ctrlem-db-picker-preview'; preview.dataset.previewId = item.id;
          preview.textContent = 'Preview'; preview.setAttribute('aria-expanded', 'false'); card.append(preview);
        }
        preview.setAttribute('aria-label', `Preview ${label}`);
      } else preview?.remove();
      let remove = card.querySelector<HTMLButtonElement>('[data-delete-id]');
      if (state.image && state.canDeleteImages) {
        if (!remove) {
          remove = this.document.createElement('button'); remove.type = 'button';
          remove.className = 'ctrlem-db-picker-delete'; remove.dataset.deleteId = item.id;
          remove.textContent = '×'; card.append(remove);
        }
        remove.setAttribute('aria-label', 'Delete image'); remove.disabled = Boolean(state.deleteBusy);
      } else remove?.remove();
      if (this.items.children[index] !== card) this.items.insertBefore(card, this.items.children[index] ?? null);
    });
    if (this.categoryId !== state.selection.categoryId) this.items.scrollTop = 0;
    this.categoryId = state.selection.categoryId;
  }
  suspend(): void { this.images?.suspend(); }
  dispose(): void { this.images?.dispose(); this.element.remove(); }
}
