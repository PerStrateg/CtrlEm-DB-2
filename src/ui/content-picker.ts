import type { Item } from '../model/library';
import type { PickerSelection } from '../shared/picker-protocol';

export interface PickerCategory { id: string; name: string; count: number }
export interface PickerViewState {
  categories: PickerCategory[]; items: Item[]; selection: PickerSelection;
  loading: boolean; loadError: boolean; error?: string;
  image: boolean; previews: boolean; previewBusy: boolean;
  emptyMessage?: string;
}
interface PickerActions {
  category(id: string): void;
  select(id: string): void;
  edit(create: boolean, initiator: HTMLElement): void;
  previews(enabled: boolean): void;
  retry(): void;
}

/** Keyed controls preserve row focus and list scroll on library updates. */
export class ContentPickerView {
  readonly element: HTMLElement;
  private readonly categories: HTMLSelectElement;
  private readonly items: HTMLElement;
  private readonly status: HTMLElement;
  private readonly retry: HTMLButtonElement;
  private readonly create: HTMLButtonElement;
  private readonly edit: HTMLButtonElement;
  private readonly previews: HTMLInputElement;
  private readonly rows = new Map<string, HTMLButtonElement>();
  private categoryId?: string;

  constructor(private readonly document: Document, label: string, actions: PickerActions) {
    this.element = document.createElement('section');
    this.element.className = 'ctrlem-db-picker';
    this.element.setAttribute('aria-label', `${label} library`);
    this.element.innerHTML = `
      <div class="ctrlem-db-picker-tools">
        <label>Category <select></select></label>
        <button type="button" data-action="create">Create category</button>
        <button type="button" data-action="edit">Edit category</button>
        <label class="ctrlem-db-picker-previews"><input type="checkbox"> Show previews</label>
      </div>
      <p class="ctrlem-db-picker-status" role="status"></p>
      <button type="button" data-action="retry" hidden>Retry</button>
      <div class="ctrlem-db-picker-items" role="group" aria-label="Entries"></div>`;
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
      const row = (event.target as Element).closest<HTMLButtonElement>('button[data-item-id]');
      if (row) actions.select(row.dataset.itemId!);
    });
  }

  render(state: PickerViewState): void {
    const options = new Map(Array.from(this.categories.options, option => [option.value, option]));
    const categoryIds = new Set(state.categories.map(category => category.id));
    for (const option of options.values()) if (!categoryIds.has(option.value)) option.remove();
    state.categories.forEach((category, index) => {
      const option = options.get(category.id) ?? this.document.createElement('option');
      option.value = category.id;
      const label = `${category.name} (${category.count})`;
      if (option.textContent !== label) option.textContent = label;
      if (this.categories.children[index] !== option) this.categories.insertBefore(option, this.categories.children[index] ?? null);
    });
    this.categories.value = state.selection.categoryId ?? '';
    this.categories.disabled = state.loading || state.loadError || !state.categories.length;
    this.create.disabled = state.loading || state.loadError;
    this.edit.disabled = this.create.disabled || !state.selection.categoryId || state.selection.categoryId === 'default';
    this.previews.parentElement!.hidden = !state.image || !state.selection.categoryId || state.selection.categoryId === 'default';
    this.previews.checked = state.previews;
    this.previews.disabled = state.previewBusy;
    const status = state.loading ? 'Loading library…' : state.loadError ? 'Couldn’t load library. Retry.'
      : state.error ?? (!state.categories.length ? 'No categories yet.' : !state.items.length ? state.emptyMessage ?? 'No items yet.' : '');
    if (this.status.textContent !== status) this.status.textContent = status;
    this.retry.hidden = !(state.loadError || state.error);
    this.items.classList.toggle('ctrlem-db-picker-grid', state.image && state.previews);
    const ids = new Set(state.items.map(item => item.id));
    for (const [id, row] of this.rows) if (!ids.has(id)) { row.remove(); this.rows.delete(id); }
    state.items.forEach((item, index) => {
      let row = this.rows.get(item.id);
      if (!row) {
        row = this.document.createElement('button'); row.type = 'button'; row.dataset.itemId = item.id;
        const caption = this.document.createElement('span'); row.append(caption);
        this.rows.set(item.id, row);
      }
      const caption = row.querySelector('span')!;
      const label = item.label || item.value;
      if (caption.textContent !== label) caption.textContent = label;
      row.title = item.value;
      row.setAttribute('aria-pressed', String(state.selection.itemId === item.id));
      let img = row.querySelector('img');
      if (state.image && state.previews) {
        if (!img) {
          img = this.document.createElement('img'); img.loading = 'lazy'; img.alt = '';
          img.referrerPolicy = 'no-referrer';
          const failed = this.document.createElement('small'); failed.hidden = true;
          img.addEventListener('error', () => { img!.hidden = true; failed.hidden = false; failed.textContent = `Preview unavailable: ${item.value}`; });
          row.prepend(img); row.append(failed);
        }
        if (img.getAttribute('src') !== item.value) {
          img.hidden = false; row.querySelector('small')!.hidden = true; img.src = item.value;
        }
      } else { img?.remove(); row.querySelector('small')?.remove(); }
      if (this.items.children[index] !== row) this.items.insertBefore(row, this.items.children[index] ?? null);
    });
    if (this.categoryId !== state.selection.categoryId) this.items.scrollTop = 0;
    this.categoryId = state.selection.categoryId;
  }
}
