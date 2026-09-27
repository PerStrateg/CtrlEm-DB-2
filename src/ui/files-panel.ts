import { filesAccept } from '../model/files';
import type { FilesSnapshot } from '../model/files';
import { FilesGrid } from './files-grid';
import type { AutoTask } from '../model/auto-send';
import { droppedFiles, pickedFiles, type ImportFile } from '../files/import-files';

export interface FilesActions {
  toggle(): void; close(): void; add(files: ImportFile[]): Promise<void>; clear(): void; select(id: string): void;
  previews(value: boolean): void; interval(value: number): void; send(): void; auto(): void;
}
export class FilesPanel {
  readonly launcher: HTMLSpanElement;
  readonly button: HTMLButtonElement;
  readonly element: HTMLElement;
  readonly grid: FilesGrid;
  private readonly count: HTMLElement;
  private readonly status: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly send: HTMLButtonElement;
  private readonly auto: HTMLButtonElement;
  private readonly previews: HTMLInputElement;
  private readonly interval: HTMLInputElement;
  private readonly confirmation: HTMLElement;
  private readonly importButtons: HTMLButtonElement[] = [];
  private readingDrop = false;
  private importing = false;
  private dropGeneration = 0;
  constructor(doc: Document, actions: FilesActions) {
    const button = (label: string, action: () => void) => {
      const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', action); return b;
    };
    this.launcher = doc.createElement('span'); this.launcher.className = 'ctrlem-db-ui';
    this.button = button('LU', actions.toggle); this.button.className = 'ctrlem-db-button'; this.button.setAttribute('aria-label', 'Open Local Upload');
    this.button.setAttribute('aria-controls', 'ctrlem-db-files'); this.launcher.append(this.button);
    this.element = doc.createElement('section'); this.element.id = 'ctrlem-db-files'; this.element.className = 'ctrlem-db-ui ctrlem-db-files';
    this.element.setAttribute('aria-label', 'Local Upload');
    const bar = doc.createElement('div'); bar.className = 'ctrlem-db-files-bar';
    const sendBar = doc.createElement('div'); sendBar.className = 'ctrlem-db-files-bar ctrlem-db-files-send-bar';
    const title = doc.createElement('strong'); title.textContent = 'Local Upload';
    bar.append(title);
    for (const directory of [false, true]) {
      const input = doc.createElement('input'); input.type = 'file'; input.accept = filesAccept; input.multiple = true; input.hidden = true;
      input.webkitdirectory = directory; input.dataset.filesInput = directory ? 'folder' : 'files';
      input.addEventListener('change', () => { void actions.add(pickedFiles(input.files ?? [])); input.value = ''; });
      const add = button(directory ? 'Add folder' : 'Add files', () => input.click()); this.importButtons.push(add); bar.append(add, input);
    }
    const clear = button('Clear all', () => { this.confirmation.hidden = !this.confirmation.hidden; });
    this.previews = doc.createElement('input'); this.previews.type = 'checkbox';
    this.previews.addEventListener('change', () => actions.previews(this.previews.checked));
    this.previews.setAttribute('aria-label', 'Previews'); this.previews.title = 'Previews';
    const previewLabel = doc.createElement('label'); previewLabel.append(this.previews);
    this.send = button('Send (single)', actions.send);
    this.interval = doc.createElement('input'); this.interval.type = 'number'; this.interval.min = '3'; this.interval.max = '3600'; this.interval.step = '1';
    this.interval.setAttribute('aria-label', 'Local Upload interval in seconds');
    this.interval.addEventListener('change', () => { if (this.interval.reportValidity()) actions.interval(Number(this.interval.value)); });
    this.auto = button('A', actions.auto); this.auto.className = 'ctrlem-db-auto-toggle';
    this.count = doc.createElement('span'); this.count.className = 'ctrlem-db-files-count';
    const seconds = doc.createElement('label'); seconds.append(this.interval, 'sec');
    bar.append(clear, this.count, button('Close', actions.close));
    sendBar.append(this.send, seconds, this.auto, previewLabel);
    this.confirmation = doc.createElement('div'); this.confirmation.className = 'ctrlem-db-files-confirm'; this.confirmation.hidden = true;
    const confirmationText = doc.createElement('p'); confirmationText.textContent = 'Clear local files and cancel Local Upload tasks? CtrlEm uploads will remain.';
    const confirmationActions = doc.createElement('div'); confirmationActions.className = 'ctrlem-db-actions';
    confirmationActions.append(
      button('Clear files', () => { this.confirmation.hidden = true; this.cancelDrop(); actions.clear(); }), button('Cancel', () => { this.confirmation.hidden = true; clear.focus(); }));
    this.confirmation.append(confirmationText, confirmationActions);
    this.status = doc.createElement('p'); this.status.className = 'ctrlem-db-files-status'; this.status.setAttribute('role', 'status'); this.status.hidden = true;
    this.empty = doc.createElement('p'); this.empty.className = 'ctrlem-db-files-empty';
    this.empty.textContent = 'Choose local images to send through CtrlEm. JPG, PNG, GIF, WebP, BMP, AVIF and TIFF. Large files resize automatically.';
    this.empty.append(doc.createElement('br'), 'Files here aren’t added to the library due to CtrlEm limitations.');
    this.grid = new FilesGrid(doc, actions.select);
    const dropHint = doc.createElement('p'); dropHint.className = 'ctrlem-db-files-drop-hint';
    dropHint.textContent = 'Drag & drop images or folders here, or use Add files / Add folder.';
    this.element.append(bar, this.confirmation, sendBar, dropHint, this.empty, this.grid.element, this.status);
    let dragDepth = 0;
    const clearDrag = () => { dragDepth = 0; this.element.classList.remove('ctrlem-db-files-drag-active'); };
    this.element.addEventListener('dragenter', event => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault(); event.stopPropagation(); dragDepth++;
      if (!this.importing && !this.readingDrop) this.element.classList.add('ctrlem-db-files-drag-active');
    });
    this.element.addEventListener('dragover', event => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = this.importing || this.readingDrop ? 'none' : 'copy';
    });
    this.element.addEventListener('dragleave', event => {
      if (!dragDepth) return;
      event.stopPropagation(); if (--dragDepth === 0) clearDrag();
    });
    this.element.addEventListener('drop', event => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault(); event.stopPropagation(); clearDrag();
      if (this.importing || this.readingDrop) return;
      const generation = ++this.dropGeneration;
      this.readingDrop = true; this.updateImportButtons(); this.message('Reading dropped files…');
      void droppedFiles(event.dataTransfer).then(files => {
        if (generation !== this.dropGeneration) return;
        this.message(''); return actions.add(files);
      }).catch(error => {
        if (generation === this.dropGeneration) this.message(`Could not read dropped files. Try Add files or Add folder. ${error instanceof Error ? error.message : ''}`);
      }).finally(() => {
        if (generation === this.dropGeneration) { this.readingDrop = false; this.updateImportButtons(); }
      });
    });
    this.element.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); actions.close(); } });
  }
  message(value: string): void { this.status.textContent = value; this.status.hidden = !value; }
  private cancelDrop(): void { this.dropGeneration++; this.readingDrop = false; this.updateImportButtons(); }
  private updateImportButtons(): void { for (const button of this.importButtons) button.disabled = this.importing || this.readingDrop; }
  render(state: FilesSnapshot, open: boolean, task?: AutoTask, importing = false): void {
    this.button.setAttribute('aria-expanded', String(open)); this.button.setAttribute('aria-label', open ? 'Close Local Upload' : 'Open Local Upload');
    this.count.textContent = `${state.items.length} files`;
    this.empty.hidden = state.items.length > 0;
    this.previews.checked = state.previews;
    if (this.interval !== this.interval.ownerDocument.activeElement) this.interval.value = String(state.interval);
    this.interval.disabled = Boolean(task);
    this.auto.title = task ? 'Stop auto-send' : 'Start auto-send';
    this.auto.setAttribute('aria-label', this.auto.title); this.auto.setAttribute('aria-pressed', String(Boolean(task)));
    this.auto.disabled = !task && !state.items.length; this.send.disabled = !state.selected || !state.items.some(item => item.id === state.selected);
    this.importing = importing; this.updateImportButtons();
    if (!open) this.element.classList.remove('ctrlem-db-files-drag-active');
    this.grid.render(state.items, state.selected, state.previews && !this.element.ownerDocument.hidden, open);
  }
  dispose(): void { this.cancelDrop(); this.grid.dispose(); this.element.remove(); this.launcher.remove(); }
}
