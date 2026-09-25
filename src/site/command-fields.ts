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

  mountUpload(field: CommandField, element: HTMLElement): void {
    const picker = field.input.nextElementSibling;
    if (picker?.classList.contains('ctrlem-db-picker') && picker.nextElementSibling !== element) picker.after(element);
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
