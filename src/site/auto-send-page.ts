import { autoCommandKeys, autoSendLimits } from '../model/auto-send';
import type { AutoCommandKey, AutoExecution, AutoOutcome } from '../model/auto-send';
import type { AutoPageState } from '../shared/auto-send-protocol';
import { CommandFields } from './command-fields';

/** Native sends and their DOM acknowledgement; never calls the site's command API. */
export class AutoSendPage {
  private readonly attempts = new Map<string, Promise<AutoOutcome>>();
  private cancel?: () => void;
  private readonly controls = new Map<AutoCommandKey, { button: HTMLButtonElement; row: HTMLElement; anchor: Comment }>();
  private panel?: HTMLElement;
  private panelResize?: ResizeObserver;
  private toasts?: HTMLElement;
  private previousToastHeight = '';
  private previousToastPriority = '';
  constructor(readonly document: Document, private readonly fields: CommandFields) {}

  receiver(): string { return /^\/u\/([^/]+)\/?$/.exec(this.document.location.pathname)?.[1]?.toLowerCase() ?? ''; }
  button(key: AutoCommandKey): HTMLButtonElement | null {
    return this.document.querySelector<HTMLButtonElement>(`.panel--commands button[data-send="${key}"]`);
  }
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
    const button = this.button(key);
    const current = this.controls.get(key);
    if (current?.button === button && current.row.contains(button)) return;
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
    this.panelResize?.disconnect(); this.panel = undefined; this.restoreToasts();
  }
  execute(execution: AutoExecution): Promise<AutoOutcome> {
    const previous = this.attempts.get(execution.token);
    if (previous) return previous;
    const attempt = this.perform(execution);
    this.attempts.set(execution.token, attempt);
    return attempt;
  }
  private perform(execution: AutoExecution): Promise<AutoOutcome> {
    const button = this.button(execution.command), receiver = this.receiver();
    const input = this.fields.find().find(field => field.key === execution.command);
    if (execution.receiver !== receiver || !receiver || !button ||
      (execution.command !== 'sendOrDelete' && (!input || execution.value === undefined))) {
      return Promise.resolve({ status: 'paused', reason: 'unavailable' });
    }
    if (Date.now() >= execution.deadline || this.cancel) return Promise.resolve({ status: 'paused', reason: 'unknown' });
    if (button.disabled) return Promise.resolve({ status: 'paused', reason: 'busy' });
    const toasts = this.document.getElementById('toast-container');
    if (!toasts) return Promise.resolve({ status: 'paused', reason: 'unavailable' });
    if (input) this.fields.fill(input, { id: execution.token, value: execution.value! }, false);

    return new Promise(resolve => {
      const window = this.document.defaultView!;
      let ownClick = false, finished = false;
      const finish = (outcome: AutoOutcome) => {
        if (finished) return;
        finished = true; observer.disconnect(); window.clearTimeout(timer);
        this.document.removeEventListener('click', otherSend, true);
        window.removeEventListener('pagehide', detached);
        this.cancel = undefined; resolve(outcome);
      };
      const detached = () => finish({ status: 'paused', reason: 'interrupted' });
      const otherSend = (event: MouseEvent) => {
        if (ownClick || !(event.target instanceof window.Element)) return;
        const other = event.target.closest<HTMLButtonElement>('[data-send], [data-send-plugin]');
        if (other && !other.disabled) finish({ status: 'paused', reason: 'unknown' });
      };
      const observer = new window.MutationObserver(records => {
        if (this.receiver() !== receiver || !button.isConnected || !toasts.isConnected) return detached();
        for (const record of records) for (const node of record.addedNodes) {
          if (!(node instanceof window.Element) || node.parentElement !== toasts) continue;
          if (node.matches('.toast.success') && node.textContent?.trim() === 'Command sent') return finish({ status: 'success' });
          if (node.matches('.toast.error')) return finish({ status: 'paused', reason: 'failed' });
        }
      });
      const timer = window.setTimeout(() => finish({ status: 'paused', reason: 'unknown' }),
        Math.min(autoSendLimits.resultTimeoutMs, execution.deadline - Date.now()));
      this.cancel = detached;
      observer.observe(this.document, { childList: true, subtree: true });
      this.document.addEventListener('click', otherSend, true);
      window.addEventListener('pagehide', detached);
      ownClick = true; button.click(); ownClick = false;
    });
  }
  dispose(): void { this.cancel?.(); }
}
