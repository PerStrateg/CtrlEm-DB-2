import { UploadError } from '../shared/upload-errors';
import { commands } from '../model/commands';
import type { CommandKey } from '../model/commands';
import type { UploadLibraryClient } from '../shared/library-protocol';
import type { PickerContextSource } from '../shared/picker-protocol';
import { CommandFields } from '../site/command-fields';
import type { CommandField } from '../site/command-fields';
import { FileUploadView } from '../ui/file-upload';
import type { UploadRow } from '../ui/file-upload';
import { providerForType, uploadFileError } from './providers';
import type { UploadClient } from './extension-upload-client';

type UploadCommand = 'popupImage' | 'changeWallpaper' | 'popupSound' | 'videoOverlay';
interface UploadJob extends UploadRow { file?: File; fieldVersion: number; fieldValue: string }
interface UploadState { key: UploadCommand; field: CommandField; view: FileUploadView; rows: UploadJob[]; fieldVersion: number }

export class UploadController {
  private readonly states = new Map<CommandKey, UploadState>();
  private readonly pending: { state: UploadState; row: UploadJob }[] = [];
  private hasImgBBKey = false;
  private catboxAllowed = false;
  private accessError = '';
  private loadingAccess = true;
  private accessRevision = 0;
  private settingsRevision = 0;
  private stopSettings?: () => void;
  private settingsError = '';
  private loadingSettings = true;
  private running = false;
  private disposed = false;
  private stopObserving?: () => void;
  private stopEdits?: () => void;
  private unsubscribe?: () => void;
  private readonly abort = new AbortController();

  constructor(private readonly page: CommandFields, private readonly library: UploadLibraryClient,
    private readonly client: UploadClient, private readonly picker: PickerContextSource,
    private readonly settings: (initiator: HTMLElement, back: () => void) => void) {}

  start(): void {
    this.stopSettings = this.client.subscribeSettings?.(() => { void this.refreshSettings(); void this.refreshAccess(); });
    this.unsubscribe = this.picker.subscribeContext(() => this.render());
    this.stopEdits = this.page.observeFieldEdits(key => { const state = this.states.get(key); if (state) state.fieldVersion++; });
    this.stopObserving = this.page.observe(() => this.reconcile());
    this.reconcile(); void this.refreshSettings(); void this.refreshAccess();
  }
  private async refreshAccess(): Promise<void> {
    const revision = ++this.accessRevision;
    this.loadingAccess = true; this.accessError = ''; this.render();
    try {
      const allowed = this.client.catboxAllowed ? await this.client.catboxAllowed() : true;
      if (revision === this.accessRevision) this.catboxAllowed = allowed;
    } catch { if (revision === this.accessRevision) this.accessError = 'Couldn’t check Catbox access. Retry loading.'; }
    finally { if (revision === this.accessRevision) { this.loadingAccess = false; this.render(); } }
  }
  private async refreshSettings(): Promise<void> {
    const revision = ++this.settingsRevision;
    this.loadingSettings = true; this.settingsError = ''; this.render();
    try { const hasKey = await this.client.ready(); if (revision === this.settingsRevision) this.hasImgBBKey = hasKey; }
    catch { if (revision === this.settingsRevision) this.settingsError = 'Couldn’t load ImgBB settings. Retry loading.'; }
    finally { if (revision === this.settingsRevision) { this.loadingSettings = false; this.render(); } }
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
          files: files => this.choose(this.states.get(field.key)!, files),
          retry: id => {
            const current = this.states.get(field.key)!;
            const row = current.rows.find(row => row.id === id)!;
            if (row.status !== 'Failed') return;
            row.status = 'Waiting'; row.error = undefined;
            this.pending.push({ state: current, row }); this.render(); void this.drain();
          },
          settings: initiator => {
            if (type === 'sound') {
              void this.client.openAccessSettings?.().catch(() => {
                this.accessError = 'Couldn’t open provider settings. Retry loading, then enable access again.';
                this.render();
              });
            } else this.settings(initiator, () => { void this.refreshSettings(); });
          },
          refresh: () => { void this.refreshSettings(); void this.refreshAccess(); },
          clearCompleted: () => {
            const current = this.states.get(field.key)!;
            current.rows = current.rows.filter(row => row.status !== 'Saved'); this.render();
          },
          remove: id => {
            const current = this.states.get(field.key)!;
            const row = current.rows.find(row => row.id === id);
            if (!row || !['Waiting', 'Failed', 'Save failed'].includes(row.status)) return;
            for (let index = this.pending.length - 1; index >= 0; index--) {
              if (this.pending[index]!.row === row) this.pending.splice(index, 1);
            }
            delete row.file;
            current.rows = current.rows.filter(candidate => candidate !== row); this.render();
          },
        });
        state = { key: field.key as UploadCommand, field, view, rows: [], fieldVersion: 0 };
        this.states.set(field.key, state);
      }
      if (state.field.input !== field.input) state.fieldVersion++;
      state.field = field;
      this.page.mountUpload(field, state.view.element);
    }
    for (const [key, state] of this.states) if (!fields.some(field => field.key === key)) state.view.element.remove();
    this.render();
  }
  private render(): void {
    if (this.disposed) return;
    for (const state of this.states.values()) {
      const context = this.picker.context(state.key);
      const image = state.view.type === 'image';
      const sound = state.view.type === 'sound';
      const needsAccess = sound && !this.loadingAccess && !this.accessError && !this.catboxAllowed;
      this.page.setCustomUpload(state.key, Boolean(context.category));
      state.view.render(state.rows, context.category?.id, context.loading || (image && this.loadingSettings) || (sound && this.loadingAccess),
        context.loadError ? 'Couldn’t load library. Use Retry in the picker.' : image ? this.settingsError : sound ?
          this.accessError || (needsAccess ? 'Allow Catbox access to upload audio.' : '') : '',
        image && !this.loadingSettings && !this.settingsError && !this.hasImgBBKey, needsAccess);
    }
  }
  private choose(state: UploadState, files: File[]): void {
    const context = this.picker.context(state.key);
    if (!context.category || context.loading || context.loadError) return;
    if (state.view.type === 'image' && (this.loadingSettings || this.settingsError)) return;
    if (state.view.type === 'sound' && (this.loadingAccess || this.accessError || !this.catboxAllowed)) return;
    const provider = providerForType[state.view.type];
    for (const file of files) {
      const error = uploadFileError(provider, state.view.type, file);
      const row: UploadJob = { id: crypto.randomUUID(), ...(error ? {} : { file }), canRetry: !error, fileName: file.name, provider, categoryId: context.category.id,
        categoryName: context.category.name, status: error ? 'Failed' : 'Waiting', error,
        fieldVersion: state.fieldVersion, fieldValue: state.field.input.value };
      state.rows.push(row);
      if (!error) this.pending.push({ state, row });
    }
    this.render(); void this.drain();
  }
  private async drain(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    while (this.pending.length && !this.disposed) {
      const { state, row } = this.pending.shift()!;
      const error = uploadFileError(row.provider, state.view.type, row.file!);
      if (error) { row.error = error; row.status = 'Failed'; this.render(); continue; }
      row.status = 'Uploading'; row.error = undefined; this.render();
      try {
        row.url = await this.client.upload(row.provider, state.view.type, row.file!, this.abort.signal);
        delete row.file;
      } catch (error) {
        if (error instanceof UploadError && error.failure.stage === 'access') void this.refreshAccess();
        row.status = 'Failed'; row.error = error instanceof UploadError ? error.message : 'Couldn’t upload. The provider may have received this file. Retry upload if needed.';
        this.render(); continue;
      }
      if (!this.disposed) await this.save(state, row);
    }
    this.running = false; this.render();
  }
  private async save(state: UploadState, row: UploadJob): Promise<void> {
    if (!row.url || row.status === 'Saving' || row.status === 'Saved' || this.disposed) return;
    row.status = 'Saving'; row.error = undefined; this.render();
    try {
      const result = await this.library.addUpload(state.key, { categoryId: row.categoryId, value: row.url, label: row.fileName });
      if (this.disposed) return;
      if (result.status === 'missing') {
        row.status = 'Save failed'; row.error = 'Original category was deleted. Copy this URL into another category.';
      } else {
        row.status = 'Saved';
        if (this.picker.context(state.key).category?.id === row.categoryId &&
            state.fieldVersion === row.fieldVersion && state.field.input.value === row.fieldValue && state.field.input.isConnected) {
          const version = state.fieldVersion;
          this.page.fill(state.field, { id: row.id, value: row.url }, false);
          // Own fills may advance the next file in the same batch; user edits never do.
          for (const other of state.rows) if (other.categoryId === row.categoryId && other.fieldVersion === version) {
            other.fieldVersion = state.fieldVersion; other.fieldValue = row.url;
          }
        }
      }
    } catch { row.status = 'Save failed'; row.error = 'Couldn’t save the link. Retry save without uploading again.'; }
    finally { this.render(); }
  }
  dispose(): void {
    this.disposed = true; this.abort.abort(); this.stopObserving?.(); this.stopEdits?.(); this.unsubscribe?.(); this.stopSettings?.();
    for (const state of this.states.values()) state.view.element.remove();
    this.page.restoreUploads(); this.states.clear(); this.pending.length = 0;
  }
}
