import { providers, providerForType, uploadFormats } from '../upload/providers';
import type { ProviderId, UploadType } from '../upload/providers';

export interface UploadRow {
  id: string; file: File; provider: ProviderId; categoryId: string; categoryName: string;
  status: 'Waiting' | 'Uploading' | 'Saving' | 'Saved' | 'Failed' | 'Save failed';
  url?: string; error?: string;
}
interface UploadActions {
  files(files: File[]): void; retry(id: string): void; save(id: string): void;
  settings(initiator: HTMLElement): void; refresh(): void;
}

/** Uses CtrlEm's dropzone classes, without native IDs or upload routing attributes. */
export class FileUploadView {
  readonly element: HTMLElement;
  private readonly zone: HTMLElement;
  private readonly files: HTMLInputElement;
  private readonly browse: HTMLButtonElement;
  private readonly spinner: HTMLElement;
  private readonly status: HTMLElement;
  private readonly settings: HTMLButtonElement;
  private readonly refresh: HTMLButtonElement;
  private readonly rows: HTMLElement;
  private readonly rowElements = new Map<string, HTMLElement>();

  constructor(private readonly document: Document, readonly type: UploadType, actions: UploadActions) {
    this.element = document.createElement('section');
    this.element.className = 'ctrlem-db-upload';
    this.element.dataset.provider = providerForType[type];
    this.element.innerHTML = `<div class="upload-dropzone">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
      <span data-prompt></span><span class="upload-hint"></span>
      <input type="file" multiple hidden>
      <div class="upload-spinner" hidden>Uploading...</div>
      <p data-status role="status"></p>
      <button type="button" class="btn btn-secondary" data-settings hidden>Set up provider</button>
      <button type="button" class="btn btn-secondary" data-refresh hidden>Retry loading</button>
    </div><ul aria-label="Upload results"></ul>`;
    this.zone = this.element.querySelector('.upload-dropzone')!;
    this.files = this.element.querySelector('input')!;
    this.files.accept = uploadFormats[type].accept;
    this.browse = document.createElement('button');
    this.browse.type = 'button'; this.browse.className = 'upload-browse-label'; this.browse.textContent = 'browse';
    this.browse.setAttribute('aria-label', `Browse ${uploadFormats[type].media} files for ${providers[providerForType[type]].label}`);
    this.element.querySelector('[data-prompt]')!.append(`Drag & drop ${uploadFormats[type].media} or `, this.browse);
    const provider = providers[providerForType[type]];
    this.element.querySelector('.upload-hint')!.textContent = `${provider.label} · Max ${provider.maxBytes / 1024 / 1024}MB · ${uploadFormats[type].hint}`;
    this.spinner = this.element.querySelector('.upload-spinner')!;
    this.status = this.element.querySelector('[data-status]')!;
    this.settings = this.element.querySelector('[data-settings]')!;
    this.refresh = this.element.querySelector('[data-refresh]')!;
    this.rows = this.element.querySelector('ul')!;
    this.browse.onclick = () => this.files.click();
    this.files.onchange = () => { actions.files(Array.from(this.files.files ?? [])); this.files.value = ''; };
    for (const name of ['dragover', 'dragenter']) this.zone.addEventListener(name, event => {
      event.preventDefault(); event.stopPropagation();
      if (!this.files.disabled) this.zone.classList.add('drag-active');
    });
    this.zone.addEventListener('dragleave', () => this.zone.classList.remove('drag-active'));
    this.zone.addEventListener('drop', event => {
      event.preventDefault(); event.stopPropagation(); this.zone.classList.remove('drag-active');
      if (!this.files.disabled) actions.files(Array.from(event.dataTransfer?.files ?? []));
    });
    this.settings.onclick = () => actions.settings(this.settings);
    this.refresh.onclick = actions.refresh;
    this.rows.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button[data-id]');
      if (!button) return;
      if (button.dataset.action === 'retry') actions.retry(button.dataset.id!);
      else actions.save(button.dataset.id!);
    });
  }

  render(rows: UploadRow[], categoryId: string | undefined, loading: boolean, error: string, needsSetup: boolean): void {
    this.zone.hidden = !categoryId;
    this.element.hidden = !categoryId && !rows.length;
    this.files.disabled = loading || Boolean(error);
    this.browse.disabled = this.files.disabled;
    this.settings.hidden = !needsSetup;
    this.refresh.hidden = !error;
    const message = loading ? 'Loading provider settings…' : error;
    if (this.status.textContent !== message) this.status.textContent = message;
    this.status.hidden = !message;
    this.spinner.hidden = !rows.some(row => row.categoryId === categoryId && row.status === 'Uploading');
    this.rows.hidden = !rows.length;
    for (const row of rows) {
      let item = this.rowElements.get(row.id);
      if (!item) {
        item = this.document.createElement('li');
        const caption = this.document.createElement('p'); caption.setAttribute('role', 'status');
        const result = this.document.createElement('input'); result.className = 'form-input'; result.readOnly = true; result.setAttribute('aria-label', 'Uploaded URL');
        result.onclick = () => result.select();
        const retry = this.document.createElement('button'); retry.type = 'button'; retry.className = 'btn btn-secondary'; retry.dataset.action = 'retry'; retry.dataset.id = row.id; retry.textContent = 'Retry upload';
        const save = this.document.createElement('button'); save.type = 'button'; save.className = 'btn btn-secondary'; save.dataset.action = 'save'; save.dataset.id = row.id; save.textContent = 'Retry save';
        item.append(caption, result, retry, save); this.rows.append(item); this.rowElements.set(row.id, item);
      }
      const text = `${row.file.name} · ${row.categoryName} · ${row.status}${row.error ? ` · ${row.error}` : ''}`;
      if (item.querySelector('p')!.textContent !== text) item.querySelector('p')!.textContent = text;
      const result = item.querySelector('input')!; result.hidden = !row.url || row.status === 'Saved';
      if (result.value !== (row.url ?? '')) result.value = row.url ?? '';
      const retry = item.querySelector<HTMLButtonElement>('[data-action=retry]')!;
      retry.hidden = row.status !== 'Failed';
      retry.disabled = row.provider === 'imgbb' && (loading || Boolean(error));
      item.querySelector<HTMLButtonElement>('[data-action=save]')!.hidden = row.status !== 'Save failed';
    }
  }
}
