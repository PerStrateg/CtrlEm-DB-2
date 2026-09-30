import type { SendCommand, SendField } from '../model/send-command';
import { autoCommandKeys } from '../model/auto-send';

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
interface Replacement { native: HTMLButtonElement; proxy: HTMLButtonElement; hidden: boolean }
const specialButtons: Record<string, string> = { lovense: 'btn-lovense-send', openshock: 'btn-openshock-send' };

/** Owns the site's Send controls and drafts; never changes native cooldown or calls an API. */
export class NativeSend {
  private readonly replacements = new Map<string, Replacement>();
  private onSend?: (command: SendCommand) => void;
  private stopObservation?: () => void;
  constructor(private readonly document: Document) {}
  buttons(): Map<string, HTMLButtonElement> {
    const result = new Map<string, HTMLButtonElement>();
    for (const button of this.document.querySelectorAll<HTMLButtonElement>('.panel--commands button[data-send], .panel--commands button[data-send-plugin]')) {
      result.set(button.dataset.send ?? `plugin:${button.dataset.sendPlugin}`, button);
    }
    for (const [key, id] of Object.entries(specialButtons)) {
      const button = this.document.getElementById(id) as HTMLButtonElement | null;
      if (button) result.set(key, button);
    }
    return result;
  }
  button(key: string): HTMLButtonElement | undefined { return this.buttons().get(key); }
  visible(key: string): HTMLButtonElement | undefined { return this.replacements.get(key)?.proxy ?? this.button(key); }
  private panel(key: string): HTMLElement | null {
    return this.button(key)?.closest<HTMLElement>('.cmd-panel') ?? this.document.getElementById(`acc-${key.replace('plugin:', 'plugin-')}`);
  }
  private fields(key: string): Field[] {
    return Array.from(this.panel(key)?.querySelectorAll<Field>('input, textarea, select') ?? [])
      .filter(field => !field.closest('.ctrlem-db-ui, .ctrlem-db-picker, .ctrlem-db-auto-control, .ctrlem-db-upload') &&
        !field.className.includes('ctrlem-db') && !['file', 'password', 'hidden'].includes(field.type));
  }
  private fieldId(field: Field, index: number): string { return field.id || `field:${index}`; }
  private read(field: Field, id: string): SendField {
    return { id, value: field.value, ...('checked' in field ? { checked: field.checked } : {}) };
  }
  capture(key: string, validate = true): SendCommand {
    const button = this.button(key);
    if (!button) throw new Error('Command is unavailable. Reopen its page.');
    const fields = this.fields(key);
    if (validate && fields.some(field => !field.reportValidity())) throw new Error('Check the command fields.');
    const main = fields.find(field => field.id === `val-${key}` || field.id === 'val-writeForMe-text');
    if (validate && main && key !== 'reactionTest' && !main.value.trim()) throw new Error('Enter a value before sending.');
    return { key, label: this.panel(key)?.querySelector('.cmd-label')?.textContent?.trim() || key.replace('plugin:', ''),
      fields: fields.map((field, index) => this.read(field, this.fieldId(field, index))),
      device: (this.document.getElementById('target-device-select') as HTMLSelectElement | null)?.value ??
        this.document.getElementById('commands-layout')?.dataset.activeDevice,
      mode: this.panel(key)?.querySelector<HTMLElement>('.pishock-op.active, .openshock-op.active')?.dataset.op ??
        this.panel(key)?.querySelector<HTMLElement>('.openshock-op.active')?.dataset.type };
  }
  mount(send: (command: SendCommand) => void, error: (message: string) => void): void {
    this.onSend = send;
    const observer = new this.document.defaultView!.MutationObserver(() => {
      this.reconcile(error);
    });
    observer.observe(this.document, { subtree: true, childList: true });
    this.stopObservation = () => observer.disconnect();
    this.reconcile(error);
  }
  private reconcile(error: (message: string) => void): void {
    for (const [key, old] of this.replacements) if (!old.native.isConnected) { old.proxy.remove(); this.replacements.delete(key); }
    for (const [key, native] of this.buttons()) {
      if (!autoCommandKeys.some(command => command === key)) continue;
      if (this.replacements.has(key)) continue;
      const proxy = this.document.createElement('button'); proxy.type = 'button';
      proxy.className = `${native.className} ctrlem-db-queued-send`; proxy.textContent = native.textContent || 'Send';
      proxy.setAttribute('aria-label', native.getAttribute('aria-label') || 'Send');
      proxy.title = 'Add to send queue';
      proxy.addEventListener('click', () => {
        try { this.onSend?.(this.capture(key)); } catch (cause) { error(cause instanceof Error ? cause.message : 'Could not prepare command.'); }
      });
      this.replacements.set(key, { native, proxy, hidden: Boolean(native.hidden) });
      native.hidden = true; native.classList.add('ctrlem-db-native-send'); native.after(proxy);
    }
  }
  dispose(): void {
    this.stopObservation?.();
    for (const { native, proxy, hidden } of this.replacements.values()) {
      native.hidden = hidden; native.classList.remove('ctrlem-db-native-send'); proxy.remove();
    }
    this.replacements.clear(); this.onSend = undefined;
  }
}
