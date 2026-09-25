import { exportLibrary, libraryFileSchema, planImport } from '../model/library-file';
import type { ImportMode, ImportPlan, LibraryFile } from '../model/library-file';
import type { ContentType, Library } from '../model/library';
import type { LibraryClient, TransferClient } from '../shared/library-protocol';
import { LibraryTransferView } from '../ui/library-transfer';

export interface TransferEditor {
  transferState(): { library: Library; categoryId?: string; type: ContentType; hasDrafts: boolean; available: boolean };
  flushAll(): Promise<void>;
  lockTransfer(locked: boolean): Promise<void>;
  imported(library: Library, categoryIds: string[], replace: boolean): void;
}
interface PendingImport { file: LibraryFile; mode: ImportMode; plan: ImportPlan; discardDrafts: boolean }
export class TransferController {
  readonly view: LibraryTransferView;
  private pending?: PendingImport;
  private exportTarget?: { categoryId?: string };
  private busy = false;
  private disposed = false;
  constructor(container: HTMLElement, private readonly client: LibraryClient & TransferClient, private readonly editor: TransferEditor) {
    this.view = new LibraryTransferView(container.ownerDocument, {
      export: category => { this.exportTarget = { categoryId: category ? editor.transferState().categoryId : undefined }; void this.export(false); },
      file: (file, replace) => { void this.readFile(file, replace); },
      confirm: () => { void this.confirm(); }, cancel: () => { this.pending = undefined; this.exportTarget = undefined; this.view.close(); this.view.message(''); },
      retrySave: () => { void this.export(false); }, exportSaved: () => { void this.export(true); },
    });
    container.append(this.view.element); this.refresh();
  }
  refresh(): void {
    const state = this.editor.transferState();
    this.view.available(state.available, Boolean(state.categoryId && state.library.categories.some(category => category.id === state.categoryId)));
    this.view.busy(this.busy);
  }
  private async run(work: () => Promise<void>, error: string): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true; this.refresh(); this.view.message('');
    try { await work(); }
    catch { if (!this.disposed) this.view.message(error); }
    finally { this.busy = false; if (!this.disposed) this.refresh(); }
  }
  private async export(savedOnly: boolean): Promise<void> {
    await this.run(async () => {
      this.pending = undefined;
      this.view.message('Preparing export…');
      if (!savedOnly) await this.editor.flushAll();
      const loaded = await this.client.load();
      if (this.disposed) return;
      if (!savedOnly && this.editor.transferState().hasDrafts) { this.view.unsaved(); this.view.message(''); return; }
      const file = exportLibrary(loaded.library, this.exportTarget?.categoryId);
      const document = this.view.element.ownerDocument;
      const urlApi = document.defaultView!.URL;
      const blob = new document.defaultView!.Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const url = urlApi.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url;
      link.download = this.exportTarget?.categoryId ? `ctrlem-db-category-${this.exportTarget.categoryId}.json` : `ctrlem-db-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link); link.click(); link.remove();
      // Give the browser's download handoff a task to acquire the blob.
      document.defaultView!.setTimeout(() => urlApi.revokeObjectURL(url), 0);
      this.view.close(false); this.view.message(savedOnly ? 'Exported saved version. Drafts are not included.' : 'Export ready.');
    }, 'Couldn’t export. Retry Export category or Export library.');
  }
  private async readFile(file: File, replace: boolean): Promise<void> {
    await this.run(async () => {
      this.pending = undefined; this.exportTarget = undefined; this.view.close(false);
      const parsed = libraryFileSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) { this.view.message('Invalid library file. Choose a CtrlEm DB version 1 JSON export.'); return; }
      const loaded = await this.client.load();
      if (this.disposed) return;
      this.pending = { file: parsed.data, mode: replace ? 'replace' : 'append',
        plan: planImport(loaded.library, parsed.data, replace ? 'replace' : 'append'), discardDrafts: replace && this.editor.transferState().hasDrafts };
      this.showPlan();
    }, 'Couldn’t read import. Choose a valid CtrlEm DB version 1 JSON file and try again.');
  }
  private showPlan(): void {
    const pending = this.pending!;
    this.view.preview(pending.plan, pending.mode === 'replace', pending.discardDrafts);
  }
  private async confirm(): Promise<void> {
    await this.run(async () => {
      const pending = this.pending; if (!pending) return;
      await this.editor.lockTransfer(true);
      try {
        if (pending.mode === 'replace' && this.editor.transferState().hasDrafts && !pending.discardDrafts) {
          pending.discardDrafts = true; this.showPlan(); return;
        }
        const result = await this.client.import(pending.file, pending.mode, pending.plan.baseRevision);
        if (this.disposed) return;
        if (result.status === 'conflict') {
          pending.plan = planImport(result.library, pending.file, pending.mode);
          this.showPlan(); this.view.message('Library changed. Review the updated names and confirm again.'); return;
        }
        this.editor.imported(result.library, result.categoryIds, pending.mode === 'replace');
        this.pending = undefined; this.view.close(); this.view.message('Imported.');
      } finally { await this.editor.lockTransfer(false); }
    }, 'Couldn’t import. Nothing was imported. Retry the confirmation or Cancel.');
  }
  dispose(): void { this.disposed = true; this.view.element.remove(); }
}
