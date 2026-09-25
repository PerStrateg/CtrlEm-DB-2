import { commandKeys, commands } from '../model/commands';
import type { CommandKey } from '../model/commands';
import type { Item } from '../model/library';

export interface CommandField { key: CommandKey; input: HTMLInputElement | HTMLTextAreaElement }
export interface SiteGallery { available: boolean; pending: boolean; failed: boolean; items: Item[] }

/** The only picker component that knows native command and gallery markup. */
export class CommandFields {
  private readonly hiddenGalleries = new Set<HTMLElement>();
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

  observe(changed: () => void): () => void {
    const observer = new this.document.defaultView!.MutationObserver(changed);
    observer.observe(this.document, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['src', 'alt', 'data-upload-id'] });
    return () => observer.disconnect();
  }
}
