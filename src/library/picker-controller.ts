import { commands } from '../model/commands';
import type { CommandKey } from '../model/commands';
import { emptyLibrary } from '../model/library';
import type { ContentType, Item, Library } from '../model/library';
import type { LibraryClient } from '../shared/library-protocol';
import type { PickerClient, PickerSelection, PickerSelections } from '../shared/picker-protocol';
import type { PickerContext, AutoPickerSource, PickerItemChoice } from '../shared/picker-protocol';
import { CommandFields } from '../site/command-fields';
import type { CommandField, SiteGallery } from '../site/command-fields';
import { ContentPickerView } from '../ui/content-picker';
import { MediaPreview } from '../ui/media-preview';
import type { ImageLoader } from '../images/image-cache-client';

interface PickerState {
  field: CommandField; view: ContentPickerView; gallery: SiteGallery; gallerySignature: string;
  selection: PickerSelection; previewBusy: boolean;
  previewError?: { id: string; enabled: boolean; message: string };
  defaultValue?: string;
}
const emptyGallery = (): SiteGallery => ({ available: false, pending: false, failed: false, items: [] });
type OpenEditor = (type: ContentType, id: string | undefined, create: boolean, initiator: HTMLElement) => void;

export class PickerController implements AutoPickerSource {
  private readonly itemListeners = new Set<(choice: PickerItemChoice) => void>();
  private readonly autoSelections = new Map<CommandKey, Map<string, string>>();
  private readonly contextListeners = new Set<() => void>();
  private readonly contextSignatures = new Map<CommandKey, string>();
  private library: Library = emptyLibrary();
  private selections: PickerSelections = {};
  private readonly states = new Map<CommandKey, PickerState>();
  private loading = true;
  private loadError = false;
  private disposed = false;
  private stopObserving?: () => void;
  private unsubscribe?: () => void;
  private readonly preview: MediaPreview;

  constructor(private readonly page: CommandFields, private readonly client: LibraryClient & PickerClient,
    private readonly openEditor: OpenEditor, private readonly imageLoader?: ImageLoader) { this.preview = new MediaPreview(page.document); }

  context(command: CommandKey): PickerContext {
    const state = this.states.get(command);
    return { category: state ? this.category(state) : undefined, selection: state ? this.displayedSelection(state) : {},
      loading: this.loading, loadError: this.loadError };
  }
  subscribeContext(listener: () => void): () => void {
    this.contextListeners.add(listener);
    return () => this.contextListeners.delete(listener);
  }
  subscribeItemChoice(listener: (choice: PickerItemChoice) => void): () => void {
    this.itemListeners.add(listener);
    return () => this.itemListeners.delete(listener);
  }
  showAutoSelections(selections: PickerItemChoice[]): void {
    // Retain the last shown item after Stop, including while browsing another category.
    for (const { command, categoryId, itemId } of selections) {
      let categories = this.autoSelections.get(command);
      if (!categories) { categories = new Map(); this.autoSelections.set(command, categories); }
      if (categories.get(categoryId) === itemId) continue;
      categories.set(categoryId, itemId);
      const state = this.states.get(command);
      if (state?.selection.categoryId === categoryId) this.render(state);
    }
  }
  private displayedSelection(state: PickerState): PickerSelection {
    const itemId = this.autoSelections.get(state.field.key)?.get(state.selection.categoryId ?? '');
    return { ...state.selection, ...(itemId ? { itemId: this.items(state).some(item => item.id === itemId) ? itemId : undefined } : {}) };
  }

  start(): void {
    this.unsubscribe = this.client.subscribe(library => { this.accept(library); this.renderAll(); });
    this.stopObserving = this.page.observe(() => this.reconcile());
    this.reconcile(); void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true; this.loadError = false; this.renderAll();
    try {
      const loaded = await this.client.loadPicker();
      if (this.disposed) return;
      this.accept(loaded.library); this.selections = loaded.selections;
      for (const [key, state] of this.states) state.selection = { ...this.selections[key] };
    } catch { this.loadError = true; }
    finally { this.loading = false; this.renderAll(); }
  }

  private accept(library: Library): void {
    if (library.revision >= this.library.revision) this.library = library;
  }

  private reconcile(): void {
    if (this.disposed) return;
    const fields = this.page.find();
    this.page.syncGalleryVisibility(fields);
    for (const field of fields) {
      const gallery = commands[field.key].type === 'image' ? this.page.gallery(field.key)
        : field.key === 'popupSound' ? { ...emptyGallery(), available: this.page.hasNativeUpload(field.key) } : emptyGallery();
      const signature = JSON.stringify(gallery);
      let state = this.states.get(field.key);
      if (!state) {
        const view = new ContentPickerView(this.page.document, commands[field.key].label, {
          category: id => this.selectCategory(field.key, id),
          select: id => this.selectItem(field.key, id),
          preview: (id, initiator) => {
            const current = this.states.get(field.key)!;
            const item = this.items(current).find(item => item.id === id);
            const type = commands[field.key].type;
            if (item && (type === 'sound' || type === 'video')) this.preview.toggle(type, item, current.view.element, initiator);
          },
          deleteDefault: id => {
            const current = this.states.get(field.key)!;
            if (current.selection.categoryId === 'default') this.page.deleteDefault(field.key, id);
          },
          edit: (create, initiator) => {
            const current = this.states.get(field.key)!;
            this.openEditor(commands[field.key].type, create ? undefined : current.selection.categoryId, create, initiator);
          },
          previews: enabled => { void this.setPreviews(field.key, enabled); },
          retry: () => {
            if (this.loadError) void this.load();
            else {
              const current = this.states.get(field.key)!;
              if (current.previewError) void this.setPreviews(field.key, current.previewError.enabled, current.previewError.id);
            }
          },
        }, this.imageLoader);
        state = { field, view, selection: { ...this.selections[field.key] }, gallery, gallerySignature: signature,
          previewBusy: false };
        this.states.set(field.key, state);
        this.render(state);
      }
      state.field = field;
      if (field.input.nextElementSibling !== state.view.element) field.input.after(state.view.element);
      if (signature !== state.gallerySignature) {
        state.gallerySignature = signature; state.gallery = gallery; this.render(state);
      }
    }
    // Keep the view and scroll when a native panel temporarily disappears.
    for (const [key, state] of this.states) if (!fields.some(field => field.key === key)) {
      state.view.suspend(); state.view.element.remove();
    }
    this.preview.reconcile();
  }

  private category(state: PickerState) {
    return this.library.categories.find(category => category.id === state.selection.categoryId && category.type === commands[state.field.key].type);
  }
  private items(state: PickerState): Item[] {
    return state.selection.categoryId === 'default' ? state.gallery.items : this.category(state)?.items ?? [];
  }

  private renderAll(): void {
    if (!this.disposed) for (const state of this.states.values()) this.render(state);
  }
  private render(state: PickerState): void {
    const type = commands[state.field.key].type;
    const categories = this.library.categories.filter(category => category.type === type)
      .map(category => ({ id: category.id, name: category.name, count: category.items.length }));
    if (state.gallery.available) categories.push({ id: 'default', name: 'Default', count: state.gallery.items.length });
    const previousSelection = JSON.stringify(state.selection);
    const hadSelection = Boolean(state.selection.categoryId);
    if (!this.loading && !this.loadError) {
      if (!categories.some(category => category.id === state.selection.categoryId)) {
        const firstLocal = categories.find(category => category.id !== 'default');
        state.selection = firstLocal ? { categoryId: firstLocal.id } : {};
      }
      const awaitingGallery = state.selection.categoryId === 'default' && (state.gallery.pending || state.gallery.failed);
      if (!awaitingGallery && !this.items(state).some(item => item.id === state.selection.itemId)) delete state.selection.itemId;
      this.selections[state.field.key] = state.selection;
    }
    state.view.render({ categories, items: this.loading || this.loadError ? [] : this.items(state), selection: this.displayedSelection(state),
      loading: this.loading, loadError: this.loadError,
      error: state.previewError?.message,
      image: type === 'image', previews: this.category(state)?.previewsEnabled ?? true, previewBusy: state.previewBusy,
      mediaType: type === 'sound' || type === 'video' ? type : undefined,
      emptyMessage: state.selection.categoryId === 'default'
        ? type === 'sound' ? 'Upload a sound or paste a URL.' : state.gallery.failed ? 'Couldn’t load site images. Reopen the command to retry.'
          : state.gallery.pending ? 'Open the command to load site images.' : 'No items yet. Create category to add images.'
        : undefined });
    if (hadSelection && previousSelection !== JSON.stringify(state.selection)) this.persistSelection(state);
    const signature = JSON.stringify([state.selection.categoryId, this.category(state)?.revision, this.loading, this.loadError]);
    if (this.contextSignatures.get(state.field.key) !== signature) {
      this.contextSignatures.set(state.field.key, signature);
      for (const listener of this.contextListeners) listener();
    }
  }

  private selectCategory(key: CommandKey, id: string): void {
    const state = this.states.get(key)!;
    state.selection = { categoryId: id };
    this.render(state); this.persistSelection(state);
  }
  isDefaultValue(key: CommandKey, value: string): boolean {
    const state = this.states.get(key);
    return state?.defaultValue === value;
  }
  private selectItem(key: CommandKey, id: string): void {
    const state = this.states.get(key)!;
    const item = this.items(state).find(item => item.id === id); if (!item) return;
    this.page.fill(state.field, item, state.selection.categoryId === 'default');
    state.defaultValue = state.selection.categoryId === 'default' ? item.value : undefined;
    state.selection = { ...state.selection, itemId: id };
    this.autoSelections.get(key)?.delete(state.selection.categoryId!);
    this.render(state); this.persistSelection(state);
    for (const listener of this.itemListeners) listener({ command: key, categoryId: state.selection.categoryId!, itemId: id });
  }
  private persistSelection(state: PickerState): void {
    this.render(state);
    void this.client.select(state.field.key, { ...state.selection }).catch(() => undefined);
  }

  private async setPreviews(key: CommandKey, enabled: boolean, id?: string): Promise<void> {
    const state = this.states.get(key)!;
    const category = id ? this.library.categories.find(category => category.id === id) : this.category(state);
    if (state.previewBusy) return;
    state.previewError = undefined;
    if (!category) { this.render(state); return; }
    state.previewBusy = true; this.render(state);
    try {
      const result = await this.client.change({ kind: 'update', id: category.id, baseRevision: category.revision, previewsEnabled: enabled });
      if (this.disposed) return;
      this.accept(result.library);
      if (result.status === 'conflict') state.previewError = { id: category.id, enabled, message: 'Changed in another tab. Review the category and retry.' };
    } catch { /* Keep the persisted preview setting; storage errors have no UI message. */ }
    finally {
      state.previewBusy = false;
      this.renderAll();
    }
  }

  dispose(): void {
    this.preview.close(false);
    this.disposed = true; this.stopObserving?.(); this.unsubscribe?.();
    for (const state of this.states.values()) state.view.dispose();
    this.page.restoreGalleries();
  }
}
