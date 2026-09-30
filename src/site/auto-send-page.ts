import { autoCommandKeys } from '../model/auto-send';
import type { AutoCommandKey } from '../model/auto-send';
import type { AutoPageState } from '../shared/auto-send-protocol';
import { CommandFields } from './command-fields';
import { NativeSend } from './native-send';
import { receiverFromUrl } from '../model/send-command';

/** Owns the CtrlEm page controls used to configure API-backed sends. */
export class AutoSendPage {
  readonly native: NativeSend;
  private readonly controls = new Map<AutoCommandKey, { button: HTMLButtonElement; row: HTMLElement; anchor: Comment }>();
  private panel?: HTMLElement;
  private panelResize?: ResizeObserver;
  private toasts?: HTMLElement;
  private previousToastHeight = '';
  private previousToastPriority = '';
  constructor(readonly document: Document, private readonly fields: CommandFields) { this.native = new NativeSend(document); }

  receiver(): string { return receiverFromUrl(this.document.location.href); }
  button(key: string): HTMLButtonElement | null { return this.native.button(key) ?? null; }
  state(): AutoPageState {
    const fields = this.fields.find();
    return { receiver: this.receiver(), commands: autoCommandKeys.filter(key => this.button(key) &&
      (key === 'sendOrDelete' || fields.some(field => field.key === key))),
    galleries: { popupImage: this.fields.gallery('popupImage').items, changeWallpaper: this.fields.gallery('changeWallpaper').items } };
  }
  observeManual(send: () => void): () => void {
    const listener = (event: MouseEvent) => {
      if (!event.isTrusted || !(event.target instanceof this.document.defaultView!.Element)) return;
      const button = event.target.closest<HTMLButtonElement>('[data-send], [data-send-plugin]');
      if (button && !button.disabled) send();
    };
    this.document.addEventListener('click', listener, true);
    return () => this.document.removeEventListener('click', listener, true);
  }
  mountControl(key: AutoCommandKey, control: HTMLElement): void {
    const button = this.native.visible(key);
    const current = this.controls.get(key);
    if (current && button && current.button === button && current.row.contains(button)) return;
    this.unmountControl(key);
    if (!button) return;
    const anchor = this.document.createComment('CtrlEm DB Send position');
    const row = this.document.createElement('div'); row.className = 'ctrlem-db-send-row ctrlem-db-ui';
    button.before(anchor, row); row.append(button, control);
    this.controls.set(key, { button, row, anchor });
  }
  unmountControl(key: AutoCommandKey): void {
    const current = this.controls.get(key);
    if (!current) return;
    if (current.row.contains(current.button)) current.anchor.replaceWith(current.button);
    else current.anchor.remove();
    current.row.remove(); this.controls.delete(key);
  }
  placeTaskPanel(panel: HTMLElement): void {
    if (this.panel !== panel) {
      this.panelResize?.disconnect(); this.panel = panel;
      this.panelResize = new this.document.defaultView!.ResizeObserver(() => this.positionToasts());
      this.panelResize.observe(panel);
    }
    this.positionToasts();
  }
  private positionToasts(): void {
    const toast = this.panel?.isConnected && !this.panel.hidden ? this.document.getElementById('toast-container') : null;
    if (toast !== this.toasts) {
      this.restoreToasts();
      if (toast) {
        this.toasts = toast;
        this.previousToastHeight = toast.style.getPropertyValue('--ctrlem-db-auto-height');
        this.previousToastPriority = toast.style.getPropertyPriority('--ctrlem-db-auto-height');
        toast.classList.add('ctrlem-db-toasts-above-auto');
      }
    }
    if (this.toasts && this.panel) {
      const height = `${this.panel.getBoundingClientRect().height}px`;
      if (this.toasts.style.getPropertyValue('--ctrlem-db-auto-height') !== height) this.toasts.style.setProperty('--ctrlem-db-auto-height', height);
    }
  }
  private restoreToasts(): void {
    if (!this.toasts) return;
    this.toasts.classList.remove('ctrlem-db-toasts-above-auto');
    if (this.previousToastHeight) this.toasts.style.setProperty('--ctrlem-db-auto-height', this.previousToastHeight, this.previousToastPriority);
    else this.toasts.style.removeProperty('--ctrlem-db-auto-height');
    this.toasts = undefined;
  }
  restoreLayout(): void {
    for (const key of this.controls.keys()) this.unmountControl(key);
    this.panelResize?.disconnect(); this.panel = undefined; this.restoreToasts(); this.native.dispose();
  }
  dispose(): void {}
}
