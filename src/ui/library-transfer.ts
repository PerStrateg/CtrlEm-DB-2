import { ConfirmButton } from './confirm-button';
import { typeLabels } from '../model/library';
import { createInfoButton } from './info-tip';
import type { ImportPlan } from '../model/library-file';

interface TransferActions {
  export(): void;
  exportLog(): void;
  file(file: File): void;
  restoreDefaults(): void;
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
  private readonly logButton: HTMLButtonElement;
  private readonly confirmations = new Map<string, ConfirmButton>();
  private initiator?: HTMLElement;
  private busyFocus?: HTMLElement;
  constructor(private readonly document: Document, actions: TransferActions) {
    this.element = document.createElement('section'); this.element.className = 'ctrlem-db-transfer';
    this.element.setAttribute('aria-label', 'Library backups');
    this.element.innerHTML = `<h3>Library backups</h3><p>Back up all categories and entries, restore a file, or return to the bundled defaults.</p><fieldset disabled>
      <div class="ctrlem-db-actions">
        <button type="button" data-transfer="library">Export DB</button>
        <button type="button" data-transfer="import">Import DB</button>
        <button type="button" data-transfer="defaults">Restore Defaults</button>
      </div>
      <input type="file" accept=".json,application/json" hidden>
      <div class="ctrlem-db-transfer-panel" hidden></div>
      </fieldset><div class="ctrlem-db-actions"><button type="button" data-transfer="log">Export session log</button></div><p role="status"></p>`;
    this.controls = this.element.querySelector('fieldset')!;
    this.element.querySelector('[data-transfer=import]')!.after(createInfoButton(document, 'About imports', 'Choose a CtrlEm DB version 3 export, review the preview, then click Sure? to complete the import.'));
    this.panel = this.element.querySelector('.ctrlem-db-transfer-panel')!;
    this.status = this.element.querySelector('[role=status]')!;
    this.logButton = this.element.querySelector('[data-transfer=log]')!;
    this.logButton.addEventListener('click', actions.exportLog);
    const file = this.element.querySelector('input')!;
    for (const action of ['library', 'import', 'defaults']) {
      const button = this.element.querySelector<HTMLButtonElement>(`[data-transfer=${action}]`)!;
      const request = () => {
        this.initiator = button;
        if (action === 'library') actions.export();
        else if (action === 'defaults') actions.restoreDefaults();
        else { file.value = ''; file.click(); }
      };
      if (action === 'library') button.addEventListener('click', request);
      else {
        const confirmation = new ConfirmButton(button, { request, confirm: actions.confirm, cancel: actions.cancel });
        this.confirmations.set(action, confirmation);
      }
    }
    file.addEventListener('change', () => { if (file.files?.[0]) actions.file(file.files[0]); });
    this.panel.addEventListener('click', event => {
      const action = (event.target as Element).closest<HTMLButtonElement>('button')?.dataset.transfer;
      if (action === 'cancel') actions.cancel();
      if (action === 'retry') actions.retrySave();
      if (action === 'saved') actions.exportSaved();
    });
  }
  available(enabled: boolean): void {
    this.controls.hidden = !enabled;
  }
  busy(busy: boolean): void {
    this.logButton.disabled = busy;
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
  preview(plan: ImportPlan, drafts: boolean, defaults = false): void {
    this.panel.replaceChildren(this.paragraph(`${plan.categories.length} categories, ${plan.categories.reduce((count, category) => count + category.items.length, 0)} items`));
    const list = this.document.createElement('ul');
    for (const category of plan.categories) {
      const li = this.document.createElement('li'); li.textContent = `${typeLabels[category.type]}: ${category.name} (${category.items.length})`; list.append(li);
    }
    this.panel.append(list);
    for (const warning of plan.warnings) this.panel.append(this.paragraph(warning));
    const info = [
      defaults ? 'Restore the bundled default library. Export DB first to keep a backup.' : 'Import this file.',
      'This replaces all saved categories. Other extension settings are kept.',
      drafts ? 'Unsaved drafts in this tab will be discarded. Drafts in other tabs will remain as conflicts.' : '',
    ].filter(Boolean).join(' ');
    this.resetConfirmations();
    const confirmation = this.confirmations.get(defaults ? 'defaults' : 'import')!;
    confirmation.arm(info);
    confirmation.button.dataset.transfer = 'confirm'; confirmation.cancelButton.dataset.transfer = 'cancel';
    this.panel.hidden = false;
  }
  unsaved(): void {
    this.resetConfirmations();
    this.panel.replaceChildren(this.paragraph('Some drafts are not saved. Fix invalid lines or resolve conflicts before retrying, or export only saved entries.'),
      this.button('retry', 'Retry save'), this.button('saved', 'Export saved version'), this.button('cancel', 'Cancel'));
    this.panel.hidden = false;
  }
  private resetConfirmations(): void {
    for (const [action, confirmation] of this.confirmations) {
      confirmation.reset(); confirmation.button.dataset.transfer = action; delete confirmation.cancelButton.dataset.transfer;
    }
  }
  close(restoreFocus = true): void {
    this.resetConfirmations();
    this.panel.hidden = true; this.panel.replaceChildren();
    if (restoreFocus) this.initiator?.focus({ preventScroll: true });
  }
}
