import { commandKeys, commands } from '../model/commands';
import type { CommandKey } from '../model/commands';
import type { Item } from '../model/library';
import type { NativeUpload } from '../model/files';

export interface CommandField { key: CommandKey; input: HTMLInputElement | HTMLTextAreaElement }
export interface SiteGallery { available: boolean; pending: boolean; failed: boolean; items: Item[] }

/** The only picker component that knows native command and gallery markup. */
export class CommandFields {
  private readonly hiddenGalleries = new Set<HTMLElement>();
  private readonly hiddenUploadNodes = new Set<HTMLElement>();
  private readonly uploadLabels = new Set<HTMLElement>();
  constructor(readonly document: Document) {}

  syncGalleryVisibility(fields: CommandField[]): void {
    const galleries = new Set(fields.filter(field => commands[field.key].type === 'image')
      .map(field => this.document.getElementById(`gallery-${field.key}`)).filter(element => element !== null));
    for (const gallery of this.hiddenGalleries) if (!galleries.has(gallery)) {
      gallery.classList.remove('ctrlem-db-native-gallery-hidden'); this.hiddenGalleries.delete(gallery);
    }
    for (const gallery of galleries) {
      gallery.classList.add('ctrlem-db-native-gallery-hidden'); this.hiddenGalleries.add(gallery);
    }
  }

  restoreGalleries(): void {
    for (const gallery of this.hiddenGalleries) gallery.classList.remove('ctrlem-db-native-gallery-hidden');
    this.hiddenGalleries.clear();
  }

  deleteDefault(key: CommandKey, id: string): void {
    const wrapper = Array.from(this.document.querySelectorAll<HTMLElement>(`#gallery-${key} .gallery-thumb-wrapper`))
      .find(element => element.dataset.uploadId === id);
    wrapper?.querySelector<HTMLButtonElement>('.gallery-thumb-delete')?.click();
  }

  find(): CommandField[] {
    return commandKeys.flatMap(key => {
      const input = this.document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        `.panel--commands #${commands[key].fieldId}`);
      return input ? [{ key, input }] : [];
    });
  }

  mountUpload(field: CommandField, element: HTMLElement): void {
    const anchor = this.nativeUpload(field.key) ?? field.input.previousElementSibling?.closest('.cmd-label') ?? field.input;
    const hint = this.nativeUpload(field.key)?.querySelector('.upload-hint');
    if (hint && !hint.querySelector('.ctrlem-db-native-provider')) {
      const label = this.document.createElement('strong'); label.className = 'ctrlem-db-native-provider';
      label.append('CtrlEm', this.document.createTextNode(' · ')); hint.prepend(label); this.uploadLabels.add(label);
    }
    if (anchor.previousElementSibling !== element) anchor.before(element);
  }

  private nativeUpload(key: CommandKey): HTMLElement | null {
    return this.document.querySelector(`.upload-dropzone[data-upload-for="${key}"]`);
  }
  hasNativeUpload(key: CommandKey): boolean { return Boolean(this.nativeUpload(key)); }
  setCustomUpload(key: CommandKey, active: boolean): void {
    const nodes = [this.nativeUpload(key), ...(key === 'popupSound' ? [this.document.getElementById('sound-preview')] : [])];
    for (const node of nodes) {
      if (!node) continue;
      node.classList.toggle('ctrlem-db-upload-hidden', active);
      if (active) this.hiddenUploadNodes.add(node);
      else this.hiddenUploadNodes.delete(node);
    }
  }
  restoreUploads(): void {
    for (const label of this.uploadLabels) label.remove();
    this.uploadLabels.clear();
    for (const node of this.hiddenUploadNodes) node.classList.remove('ctrlem-db-upload-hidden');
    this.hiddenUploadNodes.clear();
  }
  observeFieldEdits(changed: (key: CommandKey) => void): () => void {
    const listener = (event: Event) => {
      const field = this.find().find(field => field.input === event.target);
      if (field) changed(field.key);
    };
    this.document.addEventListener('input', listener);
    this.document.addEventListener('change', listener);
    return () => { this.document.removeEventListener('input', listener); this.document.removeEventListener('change', listener); };
  }

  gallery(key: CommandKey): SiteGallery {
    const gallery = this.document.getElementById(`gallery-${key}`);
    const items = Array.from(gallery?.querySelectorAll<HTMLElement>('.gallery-thumb-wrapper[data-upload-id]') ?? [])
      .flatMap(wrapper => {
        const img = wrapper.querySelector<HTMLImageElement>('.gallery-thumb');
        const id = wrapper.dataset.uploadId!;
        return img ? [{ id, value: `${this.document.location.origin}/api/uploads/${encodeURIComponent(id)}/image`,
          label: img.alt || img.title || undefined }] : [];
      });
    return { available: Boolean(gallery), pending: Boolean(gallery && !gallery.children.length),
      failed: gallery?.querySelector('.upload-gallery-empty')?.textContent === 'Failed to load uploads', items };
  }

  syncUploads(uploads: NativeUpload[]): void {
    for (const gallery of this.document.querySelectorAll<HTMLElement>('[id^="gallery-"]')) {
      const ids = Array.from(gallery.querySelectorAll<HTMLElement>('[data-upload-id]')).map(node => node.dataset.uploadId);
      if (JSON.stringify(ids) === JSON.stringify(uploads.map(upload => upload.id))) continue;
      const key = gallery.id.slice('gallery-'.length);
      const fragment = this.document.createDocumentFragment();
      for (const upload of uploads) {
        const wrapper = this.document.createElement('div'); wrapper.className = 'gallery-thumb-wrapper'; wrapper.dataset.uploadId = upload.id;
        const image = this.document.createElement('img'); image.className = 'gallery-thumb'; image.src = upload.url; image.alt = upload.originalName;
        image.addEventListener('click', () => {
          const input = this.document.getElementById(`val-${key}`) as HTMLInputElement | null;
          if (input) input.value = `${this.document.location.origin}${upload.url}`;
        });
        const remove = this.document.createElement('button'); remove.type = 'button'; remove.className = 'gallery-thumb-delete'; remove.textContent = '×'; remove.title = 'Delete';
        remove.addEventListener('click', event => {
          event.stopPropagation();
          void fetch(`/api/uploads/${encodeURIComponent(upload.id)}`, { method: 'DELETE', credentials: 'same-origin' }).then(response => {
            if (!response.ok) throw new Error('Failed to delete image.'); wrapper.remove();
          }).catch(() => { remove.title = 'Failed to delete image. Try again.'; });
        });
        wrapper.append(image, remove); fragment.append(wrapper);
      }
      if (!uploads.length) { const empty = this.document.createElement('span'); empty.className = 'upload-gallery-empty'; empty.textContent = 'No uploaded images'; fragment.append(empty); }
      gallery.replaceChildren(fragment);
    }
  }

  fill(field: CommandField, item: Item, native: boolean): void {
    if (native) {
      const wrapper = Array.from(this.document.querySelectorAll<HTMLElement>(`#gallery-${field.key} .gallery-thumb-wrapper`))
        .find(element => element.dataset.uploadId === item.id);
      wrapper?.querySelector<HTMLElement>('.gallery-thumb')?.click();
    }
    field.input.value = item.value;
    const Event = this.document.defaultView!.Event;
    field.input.dispatchEvent(new Event('input', { bubbles: true }));
    field.input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  observeManualSend(send: (field: CommandField) => void): () => void {
    const clicked = (event: MouseEvent) => {
      // Browser-generated mouse/keyboard activation only. Programmatic clicks,
      // including future scheduled sends, never enter capture.
      if (!event.isTrusted || !(event.target instanceof this.document.defaultView!.Element)) return;
      const button = event.target.closest<HTMLButtonElement>('.panel--commands button[data-send]');
      if (!button || button.disabled) return;
      const field = this.find().find(field => field.key === button.dataset.send);
      if (!field || !field.input.validity.valid || button.form?.matches(':invalid')) return;
      send(field);
    };
    this.document.addEventListener('click', clicked, true);
    return () => this.document.removeEventListener('click', clicked, true);
  }

  observe(changed: () => void): () => void {
    const observer = new this.document.defaultView!.MutationObserver(changed);
    observer.observe(this.document, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['src', 'alt', 'data-upload-id'] });
    return () => observer.disconnect();
  }
}
