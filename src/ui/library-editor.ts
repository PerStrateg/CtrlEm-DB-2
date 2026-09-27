import { ConfirmButton } from './confirm-button';
import { createInfoButton } from './info-tip';
import type { ContentType } from '../model/library';
import type { EditorDraft } from '../shared/library-protocol';

export interface CategoryRow { id: string; name: string; count: number; deleted?: boolean }
export interface EditorViewState {
  loading: boolean; error?: string; type: ContentType; categories: CategoryRow[];
  draft?: EditorDraft; status: string; nameError?: string; invalidLines: number[];
  conflict: boolean; canOverwrite: boolean; sessionError: boolean; busy: boolean; removingItem?: boolean;
}
export interface EditorActions {
  retryLoad(): void;
  selectCategory(id: string): void;
  create(name: string): Promise<string | undefined>;
  name(value: string): void;
  rename(): void;
  text(value: string): void;
  previews(enabled: boolean): void;
  position(start: number, end: number, scroll: number): void;
  retry(): void;
  overwrite(): void;
  latest(): void;
  remove(): void;
  move(id: string, beforeId: string | null): void;
  retrySession(): void;
}

/** Keeps editor controls mounted; rendering never replaces an active textarea. */
export class LibraryEditorView {
  readonly element: HTMLDivElement;
  private readonly formatInfo: HTMLButtonElement;
  private readonly rows = new Map<string, HTMLLIElement>();
  private readonly deletion: ConfirmButton;
  private selectedId?: string;
  private dragging?: string;
  private state?: EditorViewState;
  private readonly name: HTMLInputElement;
  private readonly text: HTMLTextAreaElement;
  private readonly list: HTMLUListElement;

  constructor(document: Document, private readonly actions: EditorActions) {
    this.element = document.createElement('div');
    this.element.className = 'ctrlem-db-editor ctrlem-db-ui';
    // Static markup only. User names, text and messages are assigned via textContent/value.
    this.element.innerHTML = `
      <div class="ctrlem-db-load-status" role="status"></div>
      <button type="button" class="ctrlem-db-retry-load" hidden>Retry</button>
      <div class="ctrlem-db-workspace" hidden>
        <div class="ctrlem-db-session-warning" role="status" hidden>
          Draft is only available in this tab. <button type="button">Retry</button>
        </div>
        <div class="ctrlem-db-tabpanel" id="ctrlem-db-editor-panel" role="group" aria-label="Category editor">
          <aside class="ctrlem-db-categories" aria-label="Categories">
            <button type="button" class="ctrlem-db-create">Create category</button>
            <form class="ctrlem-db-create-form" novalidate hidden>
              <label>Category name<input name="categoryName" autocomplete="off" required aria-describedby="ctrlem-db-create-error"></label>
              <p id="ctrlem-db-create-error" class="ctrlem-db-create-error" role="alert"></p>
              <div class="ctrlem-db-actions"><button type="submit">Create</button><button type="button">Cancel</button></div>
            </form>
            <p class="ctrlem-db-empty">No categories yet.</p>
            <ul class="ctrlem-db-category-list"></ul>
          </aside>
          <div class="ctrlem-db-category-editor" hidden>
            <label>Category name<input class="ctrlem-db-name" autocomplete="off" aria-describedby="ctrlem-db-name-error"></label>
            <p id="ctrlem-db-name-error" class="ctrlem-db-error" role="alert"></p>
            <div class="ctrlem-db-field-heading"><label for="ctrlem-db-items">Items</label></div><textarea id="ctrlem-db-items" class="ctrlem-db-items" rows="12" spellcheck="false" aria-describedby="ctrlem-db-line-errors"></textarea>
            <div class="ctrlem-db-editor-footer"><div class="ctrlem-db-save-status" role="status"></div></div>
            <p id="ctrlem-db-line-errors" class="ctrlem-db-error" role="alert"></p>
            <div class="ctrlem-db-line-actions ctrlem-db-actions" role="group" aria-label="Invalid lines" hidden></div>
            <label class="ctrlem-db-previews" hidden><input type="checkbox"> Enable image previews</label>
            <button type="button" class="ctrlem-db-retry-save" hidden>Retry</button>
            <div class="ctrlem-db-conflict" hidden>
              <p>Changed in another tab</p>
              <p class="ctrlem-db-deleted-note" hidden>This category was deleted. Copy your draft before loading latest.</p>
              <div class="ctrlem-db-actions"><button type="button" class="ctrlem-db-overwrite">Keep my version</button><button type="button" class="ctrlem-db-latest">Load latest</button></div>
            </div>
            <button type="button" class="ctrlem-db-delete">Delete category</button>
          </div>
        </div>
      </div>`;
    this.name = this.get('.ctrlem-db-name');
    this.text = this.get('.ctrlem-db-items');
    this.list = this.get('.ctrlem-db-category-list');

    this.formatInfo = createInfoButton(document, 'Item format', '');
    this.get('.ctrlem-db-field-heading').append(this.formatInfo);
    this.get('.ctrlem-db-retry-load').addEventListener('click', actions.retryLoad);
    this.get('.ctrlem-db-session-warning button').addEventListener('click', actions.retrySession);
    this.name.addEventListener('input', () => actions.name(this.name.value));
    this.name.addEventListener('blur', actions.rename);
    this.name.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); actions.rename(); } });
    this.text.addEventListener('input', () => { actions.text(this.text.value); this.capturePosition(); });
    for (const event of ['select', 'scroll', 'keyup', 'click']) this.text.addEventListener(event, () => this.capturePosition());
    this.get<HTMLInputElement>('.ctrlem-db-previews input').addEventListener('change', event => actions.previews((event.target as HTMLInputElement).checked));
    this.get('.ctrlem-db-retry-save').addEventListener('click', actions.retry);
    this.get('.ctrlem-db-overwrite').addEventListener('click', actions.overwrite);
    this.get('.ctrlem-db-latest').addEventListener('click', actions.latest);

    const form = this.get<HTMLFormElement>('.ctrlem-db-create-form');
    const createInput = form.querySelector('input')!;
    this.get('.ctrlem-db-create').addEventListener('click', () => { form.hidden = false; createInput.focus(); });
    form.querySelector('[type=button]')!.addEventListener('click', () => {
      form.hidden = true; this.get<HTMLButtonElement>('.ctrlem-db-create').focus();
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
      submit.disabled = true;
      const error = await actions.create(createInput.value);
      submit.disabled = false;
      this.get('.ctrlem-db-create-error').textContent = error ?? '';
      createInput.setAttribute('aria-invalid', String(Boolean(error)));
      if (!error) { form.hidden = true; createInput.value = ''; }
    });
    this.deletion = new ConfirmButton(this.get<HTMLButtonElement>('.ctrlem-db-delete'), {
      request: () => {
        const category = this.state?.categories.find(item => item.id === this.selectedId);
        this.deletion.arm(`Delete “${this.name.value}” and its ${category?.count ?? 0} saved items?`);
      },
      confirm: actions.remove,
    });
    this.list.addEventListener('dragover', event => { if (this.dragging) event.preventDefault(); });
    this.list.addEventListener('drop', event => {
      if (!this.dragging) return;
      event.preventDefault();
      const row = (event.target as Element).closest<HTMLLIElement>('li[data-category-id]');
      if (row?.dataset.categoryId !== this.dragging) actions.move(this.dragging, row?.dataset.categoryId ?? null);
      this.dragging = undefined;
    });
  }

  private get<T extends HTMLElement = HTMLElement>(selector: string): T { return this.element.querySelector<T>(selector)!; }
  focusEditor(create: boolean): void {
    if (create) {
      this.get('.ctrlem-db-create-form').hidden = false;
      this.get<HTMLInputElement>('.ctrlem-db-create-form input').focus();
    } else this.text.focus();
  }
  capturePosition(): void {
    if (this.selectedId) this.actions.position(this.text.selectionStart, this.text.selectionEnd, this.text.scrollTop);
  }

  render(state: EditorViewState): void {
    const switched = this.selectedId !== state.draft?.id || this.state?.type !== state.type;
    const creating = this.get('.ctrlem-db-create-form').contains(this.element.ownerDocument.activeElement);
    const deleting = this.deletion.armed && this.deletion.element.contains(this.element.ownerDocument.activeElement);
    const previousLines = this.state?.invalidLines.join(',');
    this.state = state;
    this.get('.ctrlem-db-load-status').textContent = state.loading ? 'Loading library…' : state.error ?? '';
    this.get('.ctrlem-db-retry-load').hidden = !state.error;
    this.get('.ctrlem-db-workspace').hidden = state.loading || Boolean(state.error);
    if (state.loading || state.error) return;
    this.get('.ctrlem-db-session-warning').hidden = !state.sessionError;
    this.get('.ctrlem-db-empty').hidden = state.categories.length > 0;
    const ids = new Set(state.categories.map(category => category.id));
    for (const [id, row] of this.rows) if (!ids.has(id)) { row.remove(); this.rows.delete(id); }
    for (const [index, category] of state.categories.entries()) {
      let row = this.rows.get(category.id);
      if (!row) {
        row = this.element.ownerDocument.createElement('li');
        row.dataset.categoryId = category.id; row.draggable = true;
        const select = this.element.ownerDocument.createElement('button');
        select.type = 'button'; select.className = 'ctrlem-db-category-select';
        select.addEventListener('click', () => this.actions.selectCategory(category.id));
        row.append(select);
        for (const [direction, label] of [[-1, 'Move up'], [1, 'Move down']] as const) {
          const move = this.element.ownerDocument.createElement('button'); move.type = 'button';
          move.textContent = direction < 0 ? '↑' : '↓'; move.title = label;
          move.addEventListener('click', () => {
            const categories = this.state!.categories;
            const position = categories.findIndex(item => item.id === category.id);
            const before = direction < 0 ? categories[position - 1] : categories[position + 2];
            this.actions.move(category.id, before?.id ?? null);
          });
          row.append(move);
        }
        row.addEventListener('dragstart', event => { this.dragging = category.id; event.dataTransfer?.setData('text/plain', category.id); });
        row.addEventListener('dragend', () => { this.dragging = undefined; });
        this.rows.set(category.id, row);
      }
      const [select, up, down] = Array.from(row.querySelectorAll('button')) as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];
      const label = `${category.name} (${category.count})${category.deleted ? ' — deleted' : ''}`;
      if (select.textContent !== label) select.textContent = label;
      select.title = label;
      select.setAttribute('aria-pressed', String(category.id === state.draft?.id));
      up.setAttribute('aria-label', `Move ${category.name} up`); down.setAttribute('aria-label', `Move ${category.name} down`);
      up.disabled = index === 0 || Boolean(category.deleted) || state.busy;
      down.disabled = index === state.categories.length - 1 || Boolean(category.deleted) || state.busy;
      if (this.list.children[index] !== row) this.list.insertBefore(row, this.list.children[index] ?? null);
    }
    if (switched) {
      this.deletion.reset();
      this.get('.ctrlem-db-create-form').hidden = true;
      this.get('.ctrlem-db-create-error').textContent = '';
    }
    this.selectedId = state.draft?.id;
    this.get('.ctrlem-db-category-editor').hidden = !state.draft;
    if (switched && deleting) {
      if (state.draft) this.name.focus();
      else this.get<HTMLButtonElement>('.ctrlem-db-create').focus();
    }
    this.get('.ctrlem-db-category-editor').inert = Boolean(state.removingItem);
    const wrap = state.type === 'text' ? 'soft' : 'off';
    if (this.text.wrap !== wrap) this.text.wrap = wrap;
    if (!state.draft) return;
    if (this.name.value !== state.draft.name) this.name.value = state.draft.name;
    if (switched || this.text.value !== state.draft.text) {
      const scrollLeft = switched ? 0 : this.text.scrollLeft;
      this.text.value = state.draft.text;
      this.text.setSelectionRange(state.draft.selectionStart, state.draft.selectionEnd);
      this.text.scrollTop = state.draft.scrollTop;
      this.text.scrollLeft = scrollLeft;
    }
    if (switched && creating) this.text.focus();
    this.get('.ctrlem-db-previews').hidden = state.type !== 'image';
    this.get<HTMLInputElement>('.ctrlem-db-previews input').checked = state.draft.previewsEnabled;
    const hint = state.type === 'text' ? 'One item per line.' : state.type === 'link' ? 'One address per line. https:// is optional.' : 'One address + optional label per line. https:// is optional.';
    this.formatInfo.dataset.info = hint;
    this.text.placeholder = state.type === 'text' ? 'Enter one phrase per line' : state.type === 'link' ? 'example.com' : 'example.com/media Optional label';
    this.name.setAttribute('aria-invalid', String(Boolean(state.nameError)));
    this.get('#ctrlem-db-name-error').textContent = state.nameError ?? '';
    this.text.setAttribute('aria-invalid', String(state.invalidLines.length > 0));
    this.get('#ctrlem-db-line-errors').textContent = state.invalidLines.length ? `Invalid lines: ${state.invalidLines.join(', ')}. Enter a web address, such as example.com.` : '';
    const lineActions = this.get('.ctrlem-db-line-actions');
    lineActions.hidden = !state.invalidLines.length;
    if (previousLines !== state.invalidLines.join(',')) {
      lineActions.replaceChildren(...state.invalidLines.map(line => {
        const button = this.element.ownerDocument.createElement('button');
        button.type = 'button'; button.textContent = `Line ${line}`;
        button.addEventListener('click', () => {
          const lines = this.text.value.split('\n');
          const start = lines.slice(0, line - 1).reduce((length, value) => length + value.length + 1, 0);
          this.text.focus(); this.text.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
          this.capturePosition();
        });
        return button;
      }));
    }
    const saveStatus = this.get('.ctrlem-db-save-status');
    if (saveStatus.textContent !== state.status) saveStatus.textContent = state.status;
    saveStatus.dataset.saved = String(state.status === 'Saved');
    const routine = ['Saved', 'Saving…', 'Unsaved changes', ''].includes(state.status);
    this.get('.ctrlem-db-editor-footer').dataset.attention = String(!routine);
    this.get('.ctrlem-db-retry-save').hidden = state.status !== 'Couldn’t save';
    this.get('.ctrlem-db-conflict').hidden = !state.conflict;
    this.get<HTMLButtonElement>('.ctrlem-db-overwrite').disabled = !state.canOverwrite || state.busy;
    this.get<HTMLButtonElement>('.ctrlem-db-latest').disabled = state.busy;
    this.get('.ctrlem-db-deleted-note').hidden = state.canOverwrite;
    this.deletion.disabled(state.busy || !state.canOverwrite);
    if (this.deletion.armed) {
      const category = state.categories.find(item => item.id === this.selectedId);
      this.deletion.arm(`Delete “${this.name.value}” and its ${category?.count ?? 0} saved items?`);
    }
  }
}
