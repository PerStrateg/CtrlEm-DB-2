import { autoCommandKeys, autoSendLimits } from '../model/auto-send';
import type { AutoCommandKey, AutoExecution, AutoOutcome } from '../model/auto-send';
import type { AutoPageState, AutoSnapshot } from '../shared/auto-send-protocol';
import { CommandFields } from './command-fields';
import { NativeSend } from './native-send';
import { receiverFromUrl } from '../model/send-command';
import { commandAcknowledged, commandRejection } from './send-result';

/** Native sends and their DOM acknowledgement; never calls the site's command API. */
export class AutoSendPage {
  private readonly attempts = new Map<string, Promise<AutoOutcome>>();
  private readonly attemptTimers = new Map<string, number>();
  private cancel?: () => void;
  readonly native: NativeSend;
  private waiting?: { token: string; cancel: () => void };
  synchronize(snapshot: AutoSnapshot | undefined): void {
    if (this.waiting && ![...(snapshot?.tasks ?? []), ...(snapshot?.sends ?? [])].some(task => task.status === 'running' && task.execution?.token === this.waiting!.token)) {
      this.waiting.cancel();
    }
  }
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
    return { receiver: this.receiver(), nativeCommands: [...this.native.buttons().keys()],
      readyCommands: [...this.native.buttons().keys()].filter(key => this.native.ready(key)), commands: autoCommandKeys.filter(key => this.button(key) &&
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
  execute(execution: AutoExecution): Promise<AutoOutcome> {
    if (Date.now() >= execution.deadline) return Promise.resolve({ status: 'paused', reason: 'unknown' });
    const previous = this.attempts.get(execution.token);
    if (previous) return previous;
    const attempt = this.perform(execution);
    this.attempts.set(execution.token, attempt);
    this.attemptTimers.set(execution.token, this.document.defaultView!.setTimeout(() => {
      this.attempts.delete(execution.token); this.attemptTimers.delete(execution.token);
    }, execution.deadline - Date.now()));
    return attempt;
  }
  private perform(execution: AutoExecution): Promise<AutoOutcome> {
    const button = this.button(execution.command), receiver = this.receiver();
    const input = this.fields.find().find(field => field.key === execution.command);
    if (execution.receiver !== receiver || !receiver || !button ||
      (!execution.parameters && execution.command !== 'sendOrDelete' && (!input || execution.value === undefined))) {
      return Promise.resolve({ status: 'paused', reason: 'unavailable' });
    }
    if (Date.now() >= execution.deadline || this.cancel) return Promise.resolve({ status: 'paused', reason: 'unknown' });
    if (!this.native.ready(execution.command)) return Promise.resolve({ status: 'paused', reason: 'busy' });
    const toasts = this.document.getElementById('toast-container');
    if (!toasts) return Promise.resolve({ status: 'paused', reason: 'unavailable' });
    const session = this.document.getElementById('profile-session-panel');
    const previousSession = session?.dataset.sessionId;
    const errorElement = this.document.getElementById(`${execution.command}-error`);
    const previousError = errorElement?.textContent;

    return new Promise(resolve => {
      const window = this.document.defaultView!;
      let ownClick = false, finished = false, clicked = false;
      const finish = (outcome: AutoOutcome) => {
        if (finished) return;
        finished = true; observer.disconnect(); window.clearTimeout(timer);
        this.document.removeEventListener('click', otherSend, true);
        window.removeEventListener('pagehide', detached);
        this.cancel = undefined; this.waiting = undefined; resolve(outcome);
      };
      const detached = () => finish({ status: 'paused', reason: clicked ? 'unknown' : 'interrupted' });
      const rejected = (message: string, inline = false) => {
        const outcome = commandRejection(execution.command, message, inline);
        if (outcome) finish(outcome);
      };
      const otherSend = (event: MouseEvent) => {
        if (ownClick || !(event.target instanceof window.Element)) return;
        const other = event.target.closest<HTMLButtonElement>('[data-send], [data-send-plugin]');
        if (other && !other.disabled) finish({ status: 'paused', reason: 'unknown' });
      };
      const observer = new window.MutationObserver(records => {
        if (this.receiver() !== receiver || !button.isConnected || !toasts.isConnected) return detached();
        if (!clicked) { sendWhenReady(); return; }
        if (execution.command === 'session' && session?.dataset.sessionId && session.dataset.sessionId !== previousSession && session.style.display === 'block') return finish({ status: 'success' });
        if (errorElement?.textContent?.trim() && (errorElement.textContent !== previousError ||
          records.some(record => record.target === errorElement || errorElement.contains(record.target)))) return rejected(errorElement.textContent.trim(), true);
        for (const record of records) for (const node of record.addedNodes) {
          if (!(node instanceof window.Element) || node.parentElement !== toasts) continue;
          if (node.matches('.toast.success') && commandAcknowledged(execution.command, node.textContent?.trim() ?? '', receiver.startsWith('group:'))) return finish({ status: 'success' });
          if (node.matches('.toast.error')) {
            rejected(node.textContent?.trim() ?? '');
            if (finished) return;
          }
        }
      });
      const sendWhenReady = () => {
        if (finished || clicked) return;
        if (Date.now() >= execution.deadline) { finish({ status: 'paused', reason: 'busy' }); return; }
        if (button.disabled) return;
        this.waiting = undefined;
        clicked = true;
        ownClick = true;
        try {
          this.native.click(execution.parameters ?? this.native.capture(execution.command, false),
            input && execution.value !== undefined ? { id: input.input.id, value: execution.value } : undefined);
        } catch { finish({ status: 'paused', reason: 'unavailable' }); }
        finally { ownClick = false; }
      };
      const timer = window.setTimeout(() => finish({ status: 'paused', reason: clicked ? 'unknown' : 'busy' }),
        Math.min(autoSendLimits.resultTimeoutMs, execution.deadline - Date.now()));
      this.cancel = detached;
      this.waiting = { token: execution.token, cancel: detached };
      observer.observe(this.document, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'style', 'data-session-id'] });
      this.document.addEventListener('click', otherSend, true);
      window.addEventListener('pagehide', detached);
      sendWhenReady();
    });
  }
  dispose(): void {
    this.cancel?.();
    for (const timer of this.attemptTimers.values()) this.document.defaultView!.clearTimeout(timer);
    this.attemptTimers.clear(); this.attempts.clear();
  }
}
