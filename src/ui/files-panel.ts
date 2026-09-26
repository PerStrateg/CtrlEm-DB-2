import { filesAccept } from '../model/files';
import type { FilesSnapshot } from '../model/files';
import { FilesGrid } from './files-grid';
import type { AutoTask } from '../model/auto-send';

export interface FilesActions {
  toggle(): void; close(): void; add(files: File[]): void; clear(): void; select(id: string): void;
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
  constructor(doc: Document, actions: FilesActions) {
    const button = (label: string, action: () => void) => {
      const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', action); return b;
    };
    this.launcher = doc.createElement('span'); this.launcher.className = 'ctrlem-db-ui';
    this.button = button('FL', actions.toggle); this.button.className = 'ctrlem-db-button'; this.button.setAttribute('aria-label', 'Open Files');
    this.button.setAttribute('aria-controls', 'ctrlem-db-files'); this.launcher.append(this.button);
    this.element = doc.createElement('section'); this.element.id = 'ctrlem-db-files'; this.element.className = 'ctrlem-db-ui ctrlem-db-files';
    this.element.setAttribute('aria-label', 'Files');
    const bar = doc.createElement('div'); bar.className = 'ctrlem-db-files-bar';
    const sendBar = doc.createElement('div'); sendBar.className = 'ctrlem-db-files-bar ctrlem-db-files-send-bar';
    const title = doc.createElement('strong'); title.textContent = 'Files';
    bar.append(title);
    for (const directory of [false, true]) {
      const input = doc.createElement('input'); input.type = 'file'; input.accept = filesAccept; input.multiple = true; input.hidden = true;
      input.webkitdirectory = directory; input.dataset.filesInput = directory ? 'folder' : 'files';
      input.addEventListener('change', () => { actions.add(Array.from(input.files ?? [])); input.value = ''; });
      const add = button(directory ? 'Add folder' : 'Add files', () => input.click()); this.importButtons.push(add); bar.append(add, input);
    }
    const clear = button('Clear all', () => { this.confirmation.hidden = !this.confirmation.hidden; });
    this.previews = doc.createElement('input'); this.previews.type = 'checkbox';
    this.previews.addEventListener('change', () => actions.previews(this.previews.checked));
    this.previews.setAttribute('aria-label', 'Previews'); this.previews.title = 'Previews';
    const previewLabel = doc.createElement('label'); previewLabel.append(this.previews);
    this.send = button('Send (single)', actions.send);
    this.interval = doc.createElement('input'); this.interval.type = 'number'; this.interval.min = '3'; this.interval.max = '3600'; this.interval.step = '1';
    this.interval.setAttribute('aria-label', 'Files interval in seconds');
    this.interval.addEventListener('change', () => { if (this.interval.reportValidity()) actions.interval(Number(this.interval.value)); });
    this.auto = button('A', actions.auto); this.auto.className = 'ctrlem-db-auto-toggle';
    this.count = doc.createElement('span'); this.count.className = 'ctrlem-db-files-count';
    const seconds = doc.createElement('label'); seconds.append(this.interval, 'sec');
    bar.append(clear, this.count, button('Close', actions.close));
    sendBar.append(this.send, seconds, this.auto, previewLabel);
    this.confirmation = doc.createElement('div'); this.confirmation.className = 'ctrlem-db-files-confirm'; this.confirmation.hidden = true;
    this.confirmation.append('Clear local files and cancel Files tasks? CtrlEm uploads will remain. ',
      button('Clear files', () => { this.confirmation.hidden = true; actions.clear(); }), button('Cancel', () => { this.confirmation.hidden = true; clear.focus(); }));
    this.status = doc.createElement('p'); this.status.className = 'ctrlem-db-files-status'; this.status.setAttribute('role', 'status'); this.status.hidden = true;
    this.empty = doc.createElement('p'); this.empty.className = 'ctrlem-db-files-empty';
    this.empty.textContent = 'Click Add files or Add folder. JPG, PNG, GIF, WebP, BMP, AVIF, TIFF. Large files resize automatically to 4.5 MB; GIFs stay animated.';
    this.grid = new FilesGrid(doc, actions.select);
    this.element.append(bar, this.confirmation, sendBar, this.empty, this.grid.element, this.status);
    this.element.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); actions.close(); } });
  }
  message(value: string): void { this.status.textContent = value; this.status.hidden = !value; }
  render(state: FilesSnapshot, open: boolean, task?: AutoTask, importing = false): void {
    this.button.setAttribute('aria-expanded', String(open)); this.button.setAttribute('aria-label', open ? 'Close Files' : 'Open Files');
    this.count.textContent = `${state.items.length} files`;
    this.empty.hidden = state.items.length > 0;
    this.previews.checked = state.previews;
    if (this.interval !== this.interval.ownerDocument.activeElement) this.interval.value = String(state.interval);
    this.interval.disabled = Boolean(task);
    this.auto.title = task ? 'Stop auto-send' : 'Start auto-send';
    this.auto.setAttribute('aria-label', this.auto.title); this.auto.setAttribute('aria-pressed', String(Boolean(task)));
    this.auto.disabled = !task && !state.items.length; this.send.disabled = !state.selected || !state.items.some(item => item.id === state.selected);
    for (const b of this.importButtons) b.disabled = importing;
    this.grid.render(state.items, state.selected, state.previews && !this.element.ownerDocument.hidden, open);
  }
  dispose(): void { this.grid.dispose(); this.element.remove(); this.launcher.remove(); }
}
