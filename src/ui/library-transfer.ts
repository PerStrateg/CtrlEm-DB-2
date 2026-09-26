import { typeLabels } from '../model/library';
import { createInfoButton } from './info-tip';
import type { ImportPlan } from '../model/library-file';
import type { ImportReview } from '../model/library-import';

interface TransferActions {
  export(): void;
  file(file: File): void;
  confirm(): void;
  cancel(): void;
  retrySave(): void;
  exportSaved(): void;
}
export class LibraryTransferView {
  readonly element: HTMLElement;
  private readonly controls: HTMLFieldSetElement;
  private readonly panel: HTMLElement;
  private readonly status: HTMLElement;
  private initiator?: HTMLElement;
  private busyFocus?: HTMLElement;
  constructor(private readonly document: Document, actions: TransferActions) {
    this.element = document.createElement('section'); this.element.className = 'ctrlem-db-transfer';
    this.element.setAttribute('aria-label', 'Import and export');
    this.element.innerHTML = `<h3>Library backups</h3><p>Back up all categories and entries, or restore them from a file.</p><fieldset disabled>
      <div class="ctrlem-db-actions">
        <button type="button" data-transfer="library">Export DB</button>
        <button type="button" data-transfer="import">Import DB</button>
      </div>
      <input type="file" accept=".json,application/json" hidden>
      <div class="ctrlem-db-transfer-panel" hidden></div>
      </fieldset><p role="status"></p>`;
    this.controls = this.element.querySelector('fieldset')!;
    this.element.querySelector('[data-transfer=import]')!.after(createInfoButton(document, 'About imports', 'Supports userscript versions 1–2 and CtrlEm DB backups. Choose a file, then click Replace DB to complete the import.'));
    this.panel = this.element.querySelector('.ctrlem-db-transfer-panel')!;
    this.status = this.element.querySelector('[role=status]')!;
    const file = this.element.querySelector('input')!;
    for (const action of ['library', 'import']) {
      const button = this.element.querySelector<HTMLButtonElement>(`[data-transfer=${action}]`)!;
      button.addEventListener('click', () => {
        this.initiator = button;
        if (action === 'library') actions.export();
        else { file.value = ''; file.click(); }
      });
    }
    file.addEventListener('change', () => { if (file.files?.[0]) actions.file(file.files[0]); });
    this.panel.addEventListener('click', event => {
      const action = (event.target as Element).closest<HTMLButtonElement>('button')?.dataset.transfer;
      if (action === 'confirm') actions.confirm();
      if (action === 'cancel') actions.cancel();
      if (action === 'retry') actions.retrySave();
      if (action === 'saved') actions.exportSaved();
    });
  }
  available(enabled: boolean): void {
    this.element.hidden = !enabled;
  }
  busy(busy: boolean): void {
    if (this.controls.disabled === busy) return;
    if (busy && this.controls.contains(this.document.activeElement)) this.busyFocus = this.document.activeElement as HTMLElement;
    this.controls.disabled = busy;
    if (!busy) {
      if (this.busyFocus?.isConnected && this.document.activeElement === this.document.body) this.busyFocus.focus({ preventScroll: true });
      this.busyFocus = undefined;
    }
  }
  message(message: string): void { this.status.textContent = message; }
  private button(action: string, label: string): HTMLButtonElement {
    const button = this.document.createElement('button'); button.type = 'button';
    button.dataset.transfer = action; button.textContent = label; return button;
  }
  private paragraph(text: string): HTMLParagraphElement {
    const p = this.document.createElement('p'); p.textContent = text; return p;
  }
  preview(plan: ImportPlan, drafts: boolean, review?: ImportReview): void {
    this.panel.replaceChildren(this.paragraph(`${plan.categories.length} categories, ${plan.categories.reduce((count, category) => count + category.items.length, 0)} items`));
    const list = this.document.createElement('ul');
    for (const category of plan.categories) {
      const li = this.document.createElement('li'); li.textContent = `${typeLabels[category.type]}: ${category.name} (${category.items.length})`; list.append(li);
    }
    this.panel.append(list);
    if (review?.legacy) {
      this.panel.append(this.paragraph(`Userscript import: ${review.originalItems} original entries. Settings are not imported.`));
      for (const warning of review.warnings) this.panel.append(this.paragraph(warning));
      if (review.exclusions.length) {
        this.panel.append(this.paragraph(`${review.exclusions.length} entries will be skipped:`));
        const exclusions = this.document.createElement('ul');
        for (const value of review.exclusions) { const item = this.document.createElement('li'); item.textContent = value; exclusions.append(item); }
        this.panel.append(exclusions);
      }
    }
    for (const warning of plan.warnings) this.panel.append(this.paragraph(warning));
    this.panel.append(this.paragraph('This replaces all saved categories. Other extension settings are kept.'));
    if (drafts) this.panel.append(this.paragraph('Unsaved drafts in this tab will be discarded. Drafts in other tabs will remain as conflicts.'));
    const label = drafts ? 'Discard drafts and replace' : 'Replace DB';
    this.panel.append(this.button('confirm', review?.exclusions.length ? `Skip ${review.exclusions.length} entries and ${label.toLowerCase()}` : label), this.button('cancel', 'Cancel'));
    this.panel.hidden = false;
  }
  unsaved(): void {
    this.panel.replaceChildren(this.paragraph('Some drafts are not saved. Fix invalid lines or resolve conflicts before retrying, or export only saved entries.'),
      this.button('retry', 'Retry save'), this.button('saved', 'Export saved version'), this.button('cancel', 'Cancel'));
    this.panel.hidden = false;
  }
  close(restoreFocus = true): void {
    this.panel.hidden = true; this.panel.replaceChildren();
    if (restoreFocus) this.initiator?.focus({ preventScroll: true });
  }
}
