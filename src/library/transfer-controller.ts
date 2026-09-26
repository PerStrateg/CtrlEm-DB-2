import { exportLibrary, planImport } from '../model/library-file';
import { LibraryImportError, readLibraryImport } from '../model/library-import';
import type { ImportReview } from '../model/library-import';
import type { ImportPlan, LibraryFile } from '../model/library-file';
import type { ContentType, Library } from '../model/library';
import type { LibraryClient, TransferClient } from '../shared/library-protocol';
import { LibraryTransferView } from '../ui/library-transfer';

export interface TransferEditor {
  transferState(): { library: Library; categoryId?: string; type: ContentType; hasDrafts: boolean; available: boolean };
  flushAll(): Promise<void>;
  lockTransfer(locked: boolean): Promise<void>;
  imported(library: Library, categoryIds: string[], replace: boolean): void;
}
interface PendingImport { file: LibraryFile; plan: ImportPlan; discardDrafts: boolean; review: ImportReview }
export class TransferController {
  readonly view: LibraryTransferView;
  private pending?: PendingImport;
  private busy = false;
  private disposed = false;
  constructor(container: HTMLElement, private readonly client: LibraryClient & TransferClient, private readonly editor: TransferEditor) {
    this.view = new LibraryTransferView(container.ownerDocument, {
      export: () => { void this.export(false); },
      file: file => { void this.readFile(file); },
      confirm: () => { void this.confirm(); }, cancel: () => { this.pending = undefined; this.view.close(); this.view.message(''); },
      retrySave: () => { void this.export(false); }, exportSaved: () => { void this.export(true); },
    });
    container.append(this.view.element); this.refresh();
  }
  refresh(): void {
    const state = this.editor.transferState();
    this.view.available(state.available);
    this.view.busy(this.busy);
  }
  private async run(work: () => Promise<void>, error: string): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true; this.refresh(); this.view.message('');
    try { await work(); }
    catch (cause) { if (!this.disposed) this.view.message(cause instanceof LibraryImportError ? cause.message : error); }
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
      const file = exportLibrary(loaded.library);
      const document = this.view.element.ownerDocument;
      const urlApi = document.defaultView!.URL;
      const blob = new document.defaultView!.Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const url = urlApi.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url;
      link.download = `ctrlem-db-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link); link.click(); link.remove();
      // Give the browser's download handoff a task to acquire the blob.
      document.defaultView!.setTimeout(() => urlApi.revokeObjectURL(url), 0);
      this.view.close(false); this.view.message(savedOnly ? 'Exported saved version. Drafts are not included.' : 'Export ready.');
    }, 'Couldn’t export. Retry Export DB.');
  }
  private async readFile(file: File): Promise<void> {
    await this.run(async () => {
      this.pending = undefined; this.view.close(false);
      const parsed = readLibraryImport(JSON.parse(await file.text()));
      const loaded = await this.client.load();
      if (this.disposed) return;
      this.pending = { file: parsed.file, review: parsed.review,
        plan: planImport(loaded.library, parsed.file, 'replace'), discardDrafts: this.editor.transferState().hasDrafts };
      this.showPlan();
    }, 'Couldn’t read import. Choose a valid CtrlEm DB export (version 3 or 1) or userscript export (version 1 or 2) and try again.');
  }
  private showPlan(): void {
    const pending = this.pending!;
    this.view.preview(pending.plan, pending.discardDrafts, pending.review);
  }
  private async confirm(): Promise<void> {
    await this.run(async () => {
      const pending = this.pending; if (!pending) return;
      await this.editor.lockTransfer(true);
      try {
        if (this.editor.transferState().hasDrafts && !pending.discardDrafts) {
          pending.discardDrafts = true; this.showPlan(); return;
        }
        const result = await this.client.import(pending.file, 'replace', pending.plan.baseRevision);
        if (this.disposed) return;
        if (result.status === 'conflict') {
          pending.plan = planImport(result.library, pending.file, 'replace');
          this.showPlan(); this.view.message('Library changed. Review the updated names and confirm again.'); return;
        }
        this.editor.imported(result.library, result.categoryIds, true);
        this.pending = undefined; this.view.close(); this.view.message('Imported.');
      } finally { await this.editor.lockTransfer(false); }
    }, 'Couldn’t import. Nothing was imported. Retry the confirmation or Cancel.');
  }
  dispose(): void { this.disposed = true; this.view.element.remove(); }
}
