import { CtrlEmPage, type ResultsMount } from '../site/ctrlem-page';
import { CommandFields } from '../site/command-fields';
import { ResultsController } from '../ui/results-controller';
import { FilesPanel } from '../ui/files-panel';
import { FilesClient, filesRequestValue, readFiles, readGallery } from './files-client';
import { initialFiles } from '../model/files';
import type { FilesProgressSnapshot, FilesSnapshot } from '../model/files';
import { ExtensionAutoClient } from '../auto-send/extension-auto-client';
import type { AutoSnapshot } from '../shared/auto-send-protocol';
import type { AutoTask } from '../model/auto-send';
import type { AutoSendPage } from '../site/auto-send-page';
import type { ImportFile } from './import-files';
import { classifyDiagnosticError, recordDiagnostic } from '../diagnostics/session-log';

export class FilesController {
  private readonly ui: FilesPanel;
  private readonly client = new FilesClient();
  private readonly auto = new ExtensionAutoClient();
  private state: FilesSnapshot = initialFiles();
  private task?: AutoTask;
  private queueRevision = -1;
  private progressRevision = -1;
  private pendingSelection?: string;
  private open = false;
  private importing = false;
  private disposed = false;
  private mount?: ResultsMount;
  private target?: HTMLElement;
  private readonly processor: HTMLIFrameElement;
  private readonly cleanups: (() => void)[] = [];
  private galleryPending = false;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private importGeneration = 0;
  private queueError?: string;
  constructor(private readonly page: CtrlEmPage, private readonly results: ResultsController,
    private readonly fields: CommandFields, private readonly sender: AutoSendPage) {
    this.ui = new FilesPanel(page.document, {
      toggle: () => results.select(this.open ? 'site' : 'files'),
      close: () => { results.select('site'); this.ui.button.focus({ preventScroll: true }); },
      add: files => this.import(files), clear: () => { void this.clear(); },
      remove: id => { void this.remove(id); },
      select: id => { void this.select(id); }, previews: value => { void this.preference({ previews: value }); },
      interval: value => { void this.preference({ interval: value }); },
      send: () => { void this.send(); }, auto: () => { void this.toggleAuto(); },
    });
    this.processor = page.document.createElement('iframe'); this.processor.hidden = true;
    this.processor.title = 'CtrlEm image processor'; this.processor.src = chrome.runtime.getURL('files-processor.html');
  }
  start(): void {
    this.page.document.body.append(this.processor);
    this.cleanups.push(this.results.subscribe(view => {
      this.open = view === 'files';
      if (this.open) { this.reconcile(); if (this.target) this.page.alignResults(this.target); void this.refreshGallery(); }
      else { this.mount?.dispose(); this.mount = undefined; this.target = undefined; }
      this.render();
    }), this.page.observe(() => this.reconcile()), this.auto.subscribe(snapshot => this.accept(snapshot)));
    const changed = (message: FilesProgressSnapshot & { type?: string }, sender: chrome.runtime.MessageSender) => {
      if (sender.id !== chrome.runtime.id || sender.tab) return false;
      if (message.type === 'files:progress') { this.acceptProgress(message); return false; }
      if (message.type !== 'files:changed') return false;
      clearTimeout(this.refreshTimer); this.refreshTimer = setTimeout(() => { void this.refresh(); void this.refreshGallery(); }, 80); return false;
    };
    chrome.runtime.onMessage.addListener(changed);
    const focus = () => { void this.refreshGallery(); };
    const fit = () => this.ui.element.style.setProperty('--ctrlem-db-files-height', `${this.page.redgifsHeight()}px`);
    const win = this.page.document.defaultView!;
    win.addEventListener('focus', focus); win.addEventListener('resize', fit); win.visualViewport?.addEventListener('resize', fit);
    const visibility = () => this.render(); this.page.document.addEventListener('visibilitychange', visibility);
    const timer = setInterval(() => { if (this.open && !this.page.document.hidden) void this.refreshGallery(); }, 10_000);
    this.cleanups.push(() => { clearInterval(timer); clearTimeout(this.refreshTimer); chrome.runtime.onMessage.removeListener(changed);
      win.removeEventListener('focus', focus); win.removeEventListener('resize', fit); win.visualViewport?.removeEventListener('resize', fit);
      this.page.document.removeEventListener('visibilitychange', visibility); });
    fit(); this.reconcile(); void this.refresh(); void this.refreshProgress();
    void this.auto.request({ type: 'auto:snapshot' }).then(snapshot => this.accept(snapshot), error => this.error(error));
  }
  private reconcile(): void {
    if (!this.ui.launcher.isConnected) this.page.mountFilesLauncher(this.ui.launcher);
    if (!this.open) return;
    const panel = this.page.findTargets().resultsPanel;
    if (panel && (panel !== this.target || this.ui.element.parentElement !== panel)) {
      this.mount?.dispose(); this.target = panel; this.mount = this.page.mountFiles(panel, this.ui.element); this.mount.setOpen(true); this.render();
    }
  }
  private accept(snapshot: AutoSnapshot | undefined): void {
    if (!snapshot || snapshot.revision < this.queueRevision) return;
    this.queueRevision = snapshot.revision;
    const previous = this.task?.highlightedItemId;
    this.task = snapshot.tasks.find(task => task.source === 'files' && task.receiver === this.sender.receiver());
    const selected = this.task?.highlightedItemId;
    if (!this.pendingSelection && selected && selected !== previous) {
      this.state.selected = selected;
      void this.preference({ selected });
    }
    const failed = [...snapshot.sends, ...snapshot.tasks].find(task => task.source === 'files' && task.receiver === this.sender.receiver() && task.fileError);
    if (failed?.fileError) this.ui.message(failed.fileError);
    else if (this.queueError) this.ui.message('');
    this.queueError = failed?.fileError;
    this.render();
  }
  private selection(): string | undefined { return this.pendingSelection ?? this.task?.highlightedItemId ?? this.state.selected; }
  private acceptProgress(snapshot: FilesProgressSnapshot): void {
    if (this.disposed || snapshot.revision < this.progressRevision) return;
    this.progressRevision = snapshot.revision; this.ui.grid.setProgress(snapshot.items);
  }
  private async refreshProgress(): Promise<void> {
    try { this.acceptProgress(await filesRequestValue<FilesProgressSnapshot>({ type: 'files:progress' })); }
    catch (error) { this.error(error); }
  }
  private render(): void {
    if (!this.disposed) this.ui.render({ ...this.state, selected: this.selection() }, this.open, this.task, this.importing);
  }
  private error(error: unknown): void {
    if (!this.disposed) this.ui.message(error instanceof Error ? error.message : 'Local Upload operation failed. Try again.');
  }
  private async refresh(): Promise<void> {
    try { this.state = await readFiles(); this.render(); } catch (error) { this.error(error); }
  }
  private async refreshGallery(): Promise<void> {
    if (this.galleryPending || this.disposed) return; this.galleryPending = true;
    try {
      const gallery = await readGallery();
      if (gallery.error) throw new Error(gallery.error);
      this.fields.syncUploads(gallery.uploads); await this.refresh(); await this.refreshProgress();
    } catch (error) { this.error(error); }
    finally { this.galleryPending = false; }
  }
  private async preference(change: Partial<Pick<FilesSnapshot, 'previews' | 'interval' | 'selected'>>): Promise<void> {
    try { this.state = await filesRequestValue({ type: 'files:preferences', ...change }); this.render(); } catch (error) { this.error(error); }
  }
  private async select(id: string): Promise<void> {
    this.pendingSelection = id;
    this.state.selected = id; this.render();
    await this.preference({ selected: id });
    if (this.task) {
      try { this.accept(await this.auto.request({ type: 'auto:seek', taskId: this.task.id, source: 'files', itemId: id })); }
      catch (error) { this.error(error); }
    }
    if (this.pendingSelection === id) this.pendingSelection = undefined;
    this.render();
  }
  private async import(files: ImportFile[]): Promise<void> {
    if (this.importing || !files.length) return;
    const started = performance.now();
    const sequence = ++this.importGeneration;
    const sorted = files.filter(({ file }) => /\.(jpe?g|png|gif|webp|bmp|avif|tiff?)$/i.test(file.name))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
    recordDiagnostic('files.import', { outcome: 'start', count: sorted.length, bytes: sorted.reduce((sum, { file }) => sum + file.size, 0) });
    this.importing = true; this.render();
    try {
      const initial = await readFiles();
      for (let i = 0; i < sorted.length; i++) {
        if (sequence !== this.importGeneration || this.disposed) break;
        const { file, path } = sorted[i]!;
        recordDiagnostic('files.import', { outcome: 'start', filename: file.name });
        this.ui.message(`Importing ${i + 1} of ${sorted.length}…`);
        await this.client.put(file, { id: '', generation: initial.generation, part: 'original', name: file.name, path });
      }
      if (sequence === this.importGeneration) this.ui.message(sorted.length ? '' : 'Choose JPG, PNG, GIF, WebP, BMP, AVIF or TIFF images.');
      await this.refresh();
      recordDiagnostic('files.import', { outcome: sequence === this.importGeneration && !this.disposed ? 'success' : 'cancelled',
        count: sorted.length, durationMs: Math.round(performance.now() - started) });
    } catch (error) {
      recordDiagnostic('files.import', { outcome: 'failed', code: classifyDiagnosticError(error), durationMs: Math.round(performance.now() - started) });
      this.error(error); await this.refresh();
    }
    finally { this.importing = false; this.render(); }
  }
  private async clear(): Promise<void> {
    this.importGeneration++;
    try { this.state = await filesRequestValue({ type: 'files:clear' }); this.ui.message(''); this.render(); }
    catch (error) { this.error(error); }
  }
  private async remove(id: string): Promise<void> {
    try {
      this.state = await filesRequestValue({ type: 'files:remove', id });
      if (this.pendingSelection === id) this.pendingSelection = undefined;
      this.accept(await this.auto.request({ type: 'auto:snapshot' }));
      this.ui.message(''); this.render();
    } catch (error) { this.error(error); }
  }
  private async send(): Promise<void> {
    try {
      const parameters = this.sender.native.capture('popupImage', false); parameters.label = 'Popup Image · Local Upload';
      this.accept(await this.auto.request({ type: 'auto:enqueue', id: crypto.randomUUID(), createdAt: Date.now(), parameters,
        source: 'files', fileId: this.selection() })); this.ui.message('');
    } catch (error) { this.error(error); }
  }
  private async toggleAuto(): Promise<void> {
    try {
      this.accept(await this.auto.request(this.task ? { type: 'auto:stop', id: this.task.id } :
        { type: 'auto:start', source: 'files', command: 'popupImage', itemId: this.state.selected, intervalSeconds: this.state.interval,
          parameters: this.sender.native.capture('popupImage', false) })); this.ui.message('');
    } catch (error) { this.error(error); }
  }
  dispose(): void {
    this.disposed = true; this.importGeneration++;
    for (const cleanup of this.cleanups) cleanup();
    this.mount?.dispose(); this.page.removeFilesLauncher(this.ui.launcher); this.ui.dispose(); this.processor.remove();
  }
}
