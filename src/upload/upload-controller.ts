import { commands } from '../model/commands';
import type { CommandKey } from '../model/commands';
import { emptyLibrary, formatItems } from '../model/library';
import type { ContentType, Library } from '../model/library';
import type { LibraryClient } from '../shared/library-protocol';
import { CommandFields } from '../site/command-fields';
import { FileUploadView } from '../ui/file-upload';
import type { UploadRow } from '../ui/file-upload';
import { providers, uploadFileError } from './providers';
import type { ProviderId } from './providers';
import type { UploadClient } from './extension-upload-client';

interface UploadState { view: FileUploadView; rows: UploadRow[] }
export class UploadController {
  private readonly states = new Map<CommandKey, UploadState>();
  private library = emptyLibrary();
  private imgbbReady = false;
  private error = '';
  private loading = true;
  private running = false;
  private disposed = false;
  private stopObserving?: () => void;
  private unsubscribe?: () => void;
  private readonly abort = new AbortController();

  constructor(private readonly page: CommandFields, private readonly libraryClient: LibraryClient,
    private readonly client: UploadClient, private readonly settings: (initiator: HTMLElement, back: () => void) => void,
    private readonly create: (type: ContentType, initiator: HTMLElement) => void) {}

  start(): void {
    this.unsubscribe = this.libraryClient.subscribe(library => { this.accept(library); this.render(); });
    this.stopObserving = this.page.observe(() => this.reconcile());
    this.reconcile();
    void this.refresh();
  }
  private accept(library: Library): void { if (library.revision >= this.library.revision) this.library = library; }
  private async refresh(): Promise<void> {
    this.loading = true; this.error = ''; this.render();
    try {
      const [loaded, ready] = await Promise.all([this.libraryClient.load(), this.client.ready()]);
      this.accept(loaded.library); this.imgbbReady = ready;
    } catch { this.error = 'Couldn’t load library or provider settings. Retry loading.'; }
    finally { this.loading = false; this.render(); }
  }
  private reconcile(): void {
    if (this.disposed) return;
    const fields = this.page.find();
    for (const field of fields) {
      const type = commands[field.key].type;
      if (type !== 'image' && type !== 'sound' && type !== 'video') continue;
      let state = this.states.get(field.key);
      if (!state) {
        const view = new FileUploadView(this.page.document, type, {
          files: files => {
            const state = this.states.get(field.key)!;
            const provider = view.provider.value as ProviderId;
            for (const file of files) {
              const error = uploadFileError(provider, type, file);
              state.rows.push({ id: crypto.randomUUID(), file, provider, status: error ? 'Failed' : 'Waiting', error });
            }
            this.render();
          },
          start: () => { void this.run(this.states.get(field.key)!); },
          retry: id => { void this.run(this.states.get(field.key)!, id); },
          add: id => { void this.add(this.states.get(field.key)!, id); },
          settings: initiator => this.settings(initiator, () => { void this.refresh(); }),
          create: initiator => this.create(type, initiator),
          refresh: () => { void this.refresh(); },
        });
        state = { view, rows: [] }; this.states.set(field.key, state); this.render();
      }
      this.page.mountUpload(field, state.view.element);
    }
    for (const [key, state] of this.states) if (!fields.some(field => field.key === key)) state.view.element.remove();
  }
  private render(): void {
    if (this.disposed) return;
    for (const { view, rows } of this.states.values()) {
      const missingKey = view.provider.value === 'imgbb' && !this.imgbbReady;
      const limit = providers[view.provider.value as ProviderId].maxBytes / 1024 / 1024;
      const message = this.loading ? 'Loading…' : this.error || (missingKey ? 'ImgBB needs an API key. Select Set up provider.'
        : `Up to ${limit} MB per file. Upload sends files to ${providers[view.provider.value as ProviderId].label}. Select a ready URL to copy it.`);
      view.render(this.library.categories.filter(category => category.type === view.type), rows, this.running,
        message, this.loading || Boolean(this.error) || missingKey);
    }
  }
  private async run(state: UploadState, retryId?: string): Promise<void> {
    if (this.running || this.loading || this.error) return;
    this.running = true;
    const rows = state.rows.filter(row => retryId ? row.id === retryId && row.status === 'Failed' : row.status === 'Waiting');
    for (const row of rows) {
      if (this.disposed) break;
      const error = uploadFileError(row.provider, state.view.type, row.file);
      if (error) { row.error = error; row.status = 'Failed'; continue; }
      row.status = 'Uploading'; row.error = undefined; this.render();
      try {
        row.url = await this.client.upload(row.provider, state.view.type, row.file, this.abort.signal);
        row.status = 'Ready';
      } catch { row.status = 'Failed'; row.error = 'Couldn’t upload. Check settings and connection, then Retry. The provider may have received this file.'; }
      this.render();
    }
    this.running = false; this.render();
  }
  private async add(state: UploadState, id: string): Promise<void> {
    const row = state.rows.find(row => row.id === id)!;
    const category = this.library.categories.find(category => category.id === state.view.category.value && category.type === state.view.type);
    if (!row.url || row.adding || !category) return;
    row.error = undefined;
    if (category.items.some(item => item.value === row.url)) { row.added = category.name; this.render(); return; }
    row.adding = true; this.render();
    try {
      const result = await this.libraryClient.change({ kind: 'update', id: category.id, baseRevision: category.revision,
        text: formatItems([...category.items, { id: crypto.randomUUID(), value: row.url, label: row.file.name.replace(/\s+/g, ' ') }]) });
      this.accept(result.library);
      if (result.status === 'saved') row.added = category.name;
      else row.error = 'Category changed. Review the target and Add to category again.';
    } catch { row.error = 'Couldn’t add to category. The link is still available. Try Add to category again.'; }
    finally { row.adding = false; this.render(); }
  }
  dispose(): void {
    this.disposed = true; this.abort.abort(); this.stopObserving?.(); this.unsubscribe?.();
    for (const state of this.states.values()) state.view.element.remove();
    this.states.clear();
  }
}
