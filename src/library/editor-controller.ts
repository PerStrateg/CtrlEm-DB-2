import { categoryNameError, emptyLibrary, formatItems, parseItems } from '../model/library';
import type { Category, ContentType, Library, LibraryChange } from '../model/library';
import type { EditorDraft, EditorSession, LibraryClient } from '../shared/library-protocol';
import { LibraryEditorView } from '../ui/library-editor';

export const autosaveDelay = 500;
interface DraftState {
  data: EditorDraft; status: string; invalidLines: number[]; nameError?: string;
  conflict: boolean; busy: number; textVersion: number; nameVersion: number;
  timer?: ReturnType<typeof setTimeout>; work: Promise<void>;
  retry?: () => void;
}
type ExistingChange = Exclude<LibraryChange, { kind: 'create' }>;
type ChangeFields =
  | { kind: 'update'; name?: string; text?: string; previewsEnabled?: boolean }
  | { kind: 'delete' }
  | { kind: 'move'; beforeId: string | null };

export class EditorController {
  readonly view: LibraryEditorView;
  private library: Library = emptyLibrary();
  private session: EditorSession = { activeType: 'link', selected: {}, drafts: [] };
  private readonly drafts = new Map<string, DraftState>();
  private loading = true;
  private error?: string;
  private sessionError = false;
  private sessionSequence = 0;
  private unsubscribe?: () => void;
  private disposed = false;

  constructor(container: HTMLElement, private readonly client: LibraryClient, private readonly onDirty: (dirty: boolean) => void) {
    this.view = new LibraryEditorView(container.ownerDocument, {
      retryLoad: () => { void this.load(); },
      selectType: type => this.selectType(type), selectCategory: id => this.selectCategory(id),
      create: name => this.create(name), name: value => this.editName(value), rename: () => this.rename(),
      text: value => this.editText(value), previews: value => this.editPreviews(value),
      position: (start, end, scroll) => this.position(start, end, scroll),
      retry: () => this.retryActive(), overwrite: () => this.overwrite(), latest: () => this.loadLatest(),
      remove: () => this.remove(), move: (id, before) => this.move(id, before),
      retrySession: () => this.persistSession(),
    });
    container.append(this.view.element);
  }

  start(): void {
    this.unsubscribe = this.client.subscribe(library => {
      if (this.disposed) return;
      this.acceptLibrary(library);
      this.render();
    });
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true; this.error = undefined; this.render();
    try {
      const loaded = await this.client.load();
      if (this.disposed) return;
      this.session = loaded.session;
      if (loaded.library.revision >= this.library.revision) this.library = loaded.library;
      for (const draft of this.session.drafts) {
        const category = this.library.categories.find(item => item.id === draft.id);
        // A pending draft survives reload, including edits to a category deleted elsewhere.
        if (draft.dirtyName || draft.dirtyText) this.drafts.set(draft.id, this.restore(draft));
        else if (category) this.drafts.set(category.id, this.restore({ ...this.fromCategory(category),
          selectionStart: draft.selectionStart, selectionEnd: draft.selectionEnd, scrollTop: draft.scrollTop }));
      }
      this.ensureSelected();
      this.loading = false; this.render();
      // Resume only unconfirmed text writes. Name edits still commit on Enter/blur.
      for (const state of this.drafts.values()) if (state.data.dirtyText && !state.conflict) this.schedule(state);
    } catch (error) {
      if (this.disposed) return;
      this.loading = false;
      this.error = `Couldn’t load library. ${error instanceof Error ? error.message : 'Retry.'}`;
      this.render();
    }
  }

  private fromCategory(category: Category): EditorDraft {
    return { id: category.id, type: category.type, baseRevision: category.revision,
      name: category.name, text: formatItems(category.items), previewsEnabled: category.previewsEnabled,
      dirtyName: false, dirtyText: false, selectionStart: 0, selectionEnd: 0, scrollTop: 0 };
  }
  private restore(data: EditorDraft): DraftState {
    const category = this.library.categories.find(item => item.id === data.id);
    const conflict = !category || category.revision !== data.baseRevision;
    return { data, status: conflict ? 'Changed in another tab' : data.dirtyName || data.dirtyText ? 'Unsaved changes' : 'Saved',
      invalidLines: [], conflict, busy: 0, textVersion: 0, nameVersion: 0, work: Promise.resolve() };
  }
  private active(): DraftState | undefined { return this.drafts.get(this.session.selected[this.session.activeType] ?? ''); }
  private ensureSelected(): void {
    const type = this.session.activeType;
    const selected = this.session.selected[type];
    const category = this.library.categories.find(item => item.id === selected && item.type === type)
      ?? (selected && this.drafts.has(selected) ? undefined : this.library.categories.find(item => item.type === type));
    if (category) {
      this.session.selected[type] = category.id;
      if (!this.drafts.has(category.id)) this.drafts.set(category.id, this.restore(this.fromCategory(category)));
    } else if (!selected || !this.drafts.has(selected)) delete this.session.selected[type];
  }

  private acceptLibrary(library: Library, ownId?: string): void {
    if (library.revision < this.library.revision) return;
    this.library = library;
    for (const [id, state] of this.drafts) {
      if (id === ownId || state.busy) continue;
      const category = library.categories.find(item => item.id === id);
      if (category?.revision === state.data.baseRevision) continue;
      if (state.data.dirtyName || state.data.dirtyText || state === this.active()) {
        state.conflict = true; state.status = 'Changed in another tab';
      } else if (category) {
        this.drafts.set(id, this.restore({ ...this.fromCategory(category),
          selectionStart: state.data.selectionStart, selectionEnd: state.data.selectionEnd, scrollTop: state.data.scrollTop }));
      } else this.drafts.delete(id);
    }
    this.ensureSelected();
  }

  private render(): void {
    if (this.disposed) return;
    const active = this.active();
    const categories = this.library.categories.filter(category => category.type === this.session.activeType)
      .map(category => ({ id: category.id, name: category.name, count: category.items.length, deleted: false }));
    for (const state of this.drafts.values()) {
      if (state.data.type === this.session.activeType && !this.library.categories.some(item => item.id === state.data.id)) {
        categories.push({ id: state.data.id, name: state.data.name, count: 0, deleted: true });
      }
    }
    this.view.render({ loading: this.loading, error: this.error, type: this.session.activeType, categories,
      draft: active?.data, status: active?.status ?? '', nameError: active?.nameError, invalidLines: active?.invalidLines ?? [],
      conflict: active?.conflict ?? false, canOverwrite: this.library.categories.some(item => item.id === active?.data.id),
      sessionError: this.sessionError, busy: Boolean(active?.busy) });
    this.onDirty([...this.drafts.values()].some(state => state.data.dirtyName || state.data.dirtyText));
  }

  private persistSession(): void {
    if (this.loading || this.error || this.disposed) return;
    const sequence = ++this.sessionSequence;
    const session = structuredClone({ ...this.session, drafts: [...this.drafts.values()].map(state => state.data) });
    void this.client.saveSession(session).then(() => {
      if (sequence === this.sessionSequence) { this.sessionError = false; this.render(); }
    }, () => {
      if (sequence === this.sessionSequence) { this.sessionError = true; this.render(); }
    });
  }

  private selectType(type: ContentType): void {
    this.flushActive(); this.session.activeType = type; this.ensureSelected(); this.persistSession(); this.render();
  }
  private selectCategory(id: string): void {
    this.flushActive(); this.session.selected[this.session.activeType] = id; this.ensureSelected(); this.persistSession(); this.render();
  }
  private async create(name: string): Promise<string | undefined> {
    const type = this.session.activeType;
    const error = categoryNameError(this.library, type, name);
    if (error) return error;
    try {
      const result = await this.client.change({ kind: 'create', type, name });
      if (this.disposed) return;
      this.acceptLibrary(result.library);
      if (this.session.activeType === type) {
        this.flushActive(); this.session.selected[type] = result.categoryId; this.ensureSelected();
      }
      this.persistSession(); this.render();
    } catch { return 'Couldn’t create category. Retry.'; }
  }

  private editName(value: string): void {
    const state = this.active(); if (!state) return;
    state.data.name = value; state.data.dirtyName = true; state.nameVersion++;
    state.retry = undefined;
    state.nameError = undefined;
    if (!state.conflict) state.status = 'Unsaved changes';
    this.persistSession(); this.render();
  }
  private editText(value: string): void {
    const state = this.active(); if (!state) return;
    state.data.text = value; this.textChanged(state);
  }
  private editPreviews(value: boolean): void {
    const state = this.active(); if (!state) return;
    state.data.previewsEnabled = value; this.textChanged(state);
  }
  private textChanged(state: DraftState): void {
    state.data.dirtyText = true; state.textVersion++; state.invalidLines = [];
    state.retry = undefined;
    if (!state.conflict) state.status = 'Unsaved changes';
    this.persistSession(); this.schedule(state); this.render();
  }
  private position(start: number, end: number, scroll: number): void {
    const data = this.active()?.data; if (!data) return;
    if (data.selectionStart === start && data.selectionEnd === end && data.scrollTop === scroll) return;
    data.selectionStart = start; data.selectionEnd = end; data.scrollTop = scroll;
    this.persistSession();
  }
  private schedule(state: DraftState): void {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => this.saveText(state), autosaveDelay);
  }

  flushActive(): void {
    this.view.capturePosition();
    const state = this.active(); if (!state) return;
    clearTimeout(state.timer); this.rename(); this.saveText(state);
  }
  private retryActive(): void {
    const retry = this.active()?.retry;
    if (retry) retry();
    else this.flushActive();
  }
  private rename(): void {
    const state = this.active(); if (!state || !state.data.dirtyName || state.conflict) return;
    const name = state.data.name;
    state.nameError = categoryNameError(this.library, state.data.type, name, state.data.id);
    if (state.nameError) { this.render(); return; }
    const version = state.nameVersion;
    this.change(state, { kind: 'update', name }, () => {
      if (state.nameVersion === version) { state.data.name = name.trim(); state.data.dirtyName = false; }
    });
  }
  private saveText(state: DraftState): void {
    if (!state.data.dirtyText) return;
    const { text, previewsEnabled } = state.data;
    state.invalidLines = parseItems(state.data.type, text).invalidLines;
    if (state.invalidLines.length) { state.status = 'Fix highlighted lines to save'; this.render(); return; }
    if (state.conflict) return;
    const version = state.textVersion;
    this.change(state, { kind: 'update', text, previewsEnabled }, () => {
      if (state.textVersion === version) state.data.dirtyText = false;
    });
  }

  private change(state: DraftState, fields: ChangeFields, saved: () => void): void {
    state.work = state.work.then(async () => {
      if (this.disposed || state.conflict || !this.drafts.has(state.data.id)) return;
      state.retry = undefined;
      state.busy++; state.status = 'Saving…'; this.render();
      try {
        const change: ExistingChange = { ...fields, id: state.data.id, baseRevision: state.data.baseRevision };
        const result = await this.client.change(change);
        if (this.disposed) return;
        this.acceptLibrary(result.library, state.data.id);
        if (result.status === 'conflict') {
          state.conflict = true; state.status = 'Changed in another tab';
        } else {
          const category = result.library.categories.find(item => item.id === state.data.id);
          if (category) state.data.baseRevision = category.revision;
          saved();
          state.status = state.data.dirtyName || state.data.dirtyText ? 'Unsaved changes' : 'Saved';
          if (state.invalidLines.length) state.status = 'Fix highlighted lines to save';
        }
      } catch {
        state.status = 'Couldn’t save';
        if (fields.kind !== 'update') state.retry = () => this.change(state, fields, saved);
      }
      finally {
        state.busy--;
        // A newer cross-tab snapshot may have arrived while this request was in flight.
        this.acceptLibrary(this.library);
        this.persistSession(); this.render();
      }
    });
  }

  private overwrite(): void {
    const state = this.active(); if (!state) return;
    const category = this.library.categories.find(item => item.id === state.data.id); if (!category) return;
    state.nameError = categoryNameError(this.library, state.data.type, state.data.name, state.data.id);
    state.invalidLines = parseItems(state.data.type, state.data.text).invalidLines;
    if (state.nameError || state.invalidLines.length) { this.render(); return; }
    state.data.baseRevision = category.revision; state.conflict = false;
    state.data.dirtyName = true; state.data.dirtyText = true;
    const nameVersion = state.nameVersion, textVersion = state.textVersion;
    this.change(state, { kind: 'update', name: state.data.name, text: state.data.text, previewsEnabled: state.data.previewsEnabled }, () => {
      if (state.nameVersion === nameVersion) { state.data.name = state.data.name.trim(); state.data.dirtyName = false; }
      if (state.textVersion === textVersion) state.data.dirtyText = false;
    });
  }
  private loadLatest(): void {
    const state = this.active(); if (!state) return;
    clearTimeout(state.timer);
    const category = this.library.categories.find(item => item.id === state.data.id);
    if (category) this.drafts.set(category.id, this.restore(this.fromCategory(category)));
    else { this.drafts.delete(state.data.id); delete this.session.selected[this.session.activeType]; this.ensureSelected(); }
    this.persistSession(); this.render();
  }
  private remove(): void {
    const state = this.active(); if (!state) return;
    clearTimeout(state.timer);
    const categories = this.library.categories.filter(category => category.type === state.data.type);
    const index = categories.findIndex(category => category.id === state.data.id);
    const next = categories[index + 1] ?? categories[index - 1];
    this.change(state, { kind: 'delete' }, () => {
      this.drafts.delete(state.data.id);
      if (this.session.selected[state.data.type] === state.data.id) {
        if (next) this.session.selected[state.data.type] = next.id;
        else delete this.session.selected[state.data.type];
        this.ensureSelected();
      }
    });
  }
  private move(id: string, beforeId: string | null): void {
    const category = this.library.categories.find(item => item.id === id); if (!category) return;
    if (this.active()?.data.id !== id) this.selectCategory(id);
    if (!this.drafts.has(id)) this.drafts.set(id, this.restore(this.fromCategory(category)));
    this.change(this.drafts.get(id)!, { kind: 'move', beforeId }, () => {});
  }

  dispose(): void {
    this.flushActive(); this.disposed = true; this.unsubscribe?.();
    for (const state of this.drafts.values()) clearTimeout(state.timer);
    this.view.element.remove();
  }
}
