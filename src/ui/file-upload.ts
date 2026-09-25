import type { Category } from '../model/library';
import { providers } from '../upload/providers';
import type { ProviderId, UploadType } from '../upload/providers';

export interface UploadRow {
  id: string; file: File; provider: ProviderId; status: 'Waiting' | 'Uploading' | 'Ready' | 'Failed';
  url?: string; error?: string; added?: string; adding?: boolean;
}
interface UploadActions {
  files(files: File[]): void; start(): void; retry(id: string): void; add(id: string): void;
  settings(initiator: HTMLElement): void; create(initiator: HTMLElement): void; refresh(): void;
}

export class FileUploadView {
  readonly element: HTMLDetailsElement;
  readonly provider: HTMLSelectElement;
  readonly category: HTMLSelectElement;
  private readonly files: HTMLInputElement;
  private readonly start: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly refresh: HTMLButtonElement;
  private readonly rows: HTMLElement;
  private readonly rowElements = new Map<string, HTMLElement>();

  constructor(private readonly document: Document, readonly type: UploadType, actions: UploadActions) {
    this.element = document.createElement('details');
    this.element.className = 'ctrlem-db-upload';
    this.element.innerHTML = `<summary>Upload</summary>
      <label>Provider <select data-provider></select></label>
      <label>Files <input type="file" multiple></label>
      <label>Target category <select data-category></select></label>
      <div class="ctrlem-db-upload-actions">
        <button type="button" data-create>Create category</button>
        <button type="button" data-settings>Set up provider</button>
        <button type="button" data-start>Upload</button>
      </div>
      <p data-status role="status"></p><button type="button" data-refresh hidden>Retry loading</button>
      <ul aria-label="Upload queue"></ul>`;
    this.provider = this.element.querySelector('[data-provider]')!;
    this.category = this.element.querySelector('[data-category]')!;
    this.files = this.element.querySelector('input')!;
    this.files.accept = `${type === 'sound' ? 'audio' : type}/*`;
    this.start = this.element.querySelector('[data-start]')!;
    this.status = this.element.querySelector('[data-status]')!;
    this.refresh = this.element.querySelector('[data-refresh]')!;
    this.rows = this.element.querySelector('ul')!;
    for (const [id, config] of Object.entries(providers)) {
      if (!(config.types as readonly string[]).includes(type)) continue;
      const option = document.createElement('option'); option.value = id; option.textContent = config.label;
      this.provider.append(option);
    }
    this.files.onchange = () => { actions.files(Array.from(this.files.files ?? [])); this.files.value = ''; };
    this.start.onclick = actions.start;
    this.refresh.onclick = actions.refresh;
    const settings = this.element.querySelector<HTMLButtonElement>('[data-settings]')!;
    settings.onclick = () => actions.settings(settings);
    const create = this.element.querySelector<HTMLButtonElement>('[data-create]')!;
    create.onclick = () => actions.create(create);
    this.element.addEventListener('toggle', () => { if (this.element.open) actions.refresh(); });
    this.rows.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button[data-id]');
      if (!button) return;
      if (button.dataset.action === 'retry') actions.retry(button.dataset.id!);
      else actions.add(button.dataset.id!);
    });
  }

  render(categories: Category[], rows: UploadRow[], busy: boolean, message: string, blocked: boolean): void {
    const selected = this.category.value;
    const options = new Map(Array.from(this.category.options, option => [option.value, option]));
    for (const option of options.values()) if (!categories.some(category => category.id === option.value)) option.remove();
    categories.forEach((category, index) => {
      const option = options.get(category.id) ?? this.document.createElement('option');
      option.value = category.id;
      if (option.textContent !== category.name) option.textContent = category.name;
      if (this.category.children[index] !== option) this.category.insertBefore(option, this.category.children[index] ?? null);
    });
    if (categories.some(category => category.id === selected)) this.category.value = selected;
    this.category.disabled = !categories.length;
    this.start.disabled = busy || blocked || !rows.some(row => row.status === 'Waiting');
    if (this.status.textContent !== message) this.status.textContent = message;
    this.refresh.hidden = !blocked;
    for (const row of rows) {
      let item = this.rowElements.get(row.id);
      if (!item) {
        item = this.document.createElement('li');
        const caption = this.document.createElement('p');
        const result = this.document.createElement('input'); result.readOnly = true; result.setAttribute('aria-label', 'Uploaded URL');
        result.onclick = () => result.select();
        const retry = this.document.createElement('button'); retry.type = 'button'; retry.dataset.action = 'retry'; retry.dataset.id = row.id; retry.textContent = 'Retry';
        const add = this.document.createElement('button'); add.type = 'button'; add.dataset.action = 'add'; add.dataset.id = row.id; add.textContent = 'Add to category';
        item.append(caption, result, retry, add); this.rows.append(item); this.rowElements.set(row.id, item);
      }
      const text = `${row.file.name} · ${providers[row.provider].label} · ${row.status}${row.added ? ` · Added to ${row.added}` : ''}${row.error ? ` · ${row.error}` : ''}`;
      if (item.querySelector('p')!.textContent !== text) item.querySelector('p')!.textContent = text;
      const result = item.querySelector('input')!; result.hidden = !row.url;
      if (result.value !== (row.url ?? '')) result.value = row.url ?? '';
      const retry = item.querySelector<HTMLButtonElement>('[data-action=retry]')!;
      retry.hidden = row.status !== 'Failed'; retry.disabled = busy || blocked;
      const add = item.querySelector<HTMLButtonElement>('[data-action=add]')!;
      add.hidden = !row.url || Boolean(row.added); add.disabled = !categories.length || Boolean(row.adding);
    }
  }
}
