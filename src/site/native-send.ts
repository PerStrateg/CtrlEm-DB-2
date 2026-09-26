import type { SendCommand, SendField } from '../model/send-command';

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
interface Replacement { native: HTMLButtonElement; proxy: HTMLButtonElement; hidden: boolean }
const specialButtons: Record<string, string> = { lovense: 'btn-lovense-send', openshock: 'btn-openshock-send' };

/** Owns the site's Send controls and drafts; never changes native cooldown or calls an API. */
export class NativeSend {
  private readonly replacements = new Map<string, Replacement>();
  private readonly drafts = new Map<Field, SendField>();
  private applying = false;
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
  ready(key: string): boolean {
    const button = this.button(key);
    return Boolean(button?.isConnected && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
  }
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
  private write(field: Field, value: SendField): void {
    field.value = value.value;
    if ('checked' in field && value.checked !== undefined) field.checked = value.checked;
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
  /** Parameter writes are synchronous: native handlers read them before awaiting the site. */
  click(command: SendCommand, override?: { id: string; value: string }): void {
    const button = this.button(command.key);
    const fields = this.fields(command.key);
    if (!button || command.fields.some(saved => !fields.some((field, i) => this.fieldId(field, i) === saved.id))) {
      throw new Error('Command fields changed. Reopen its page.');
    }
    this.rememberDrafts();
    const device = this.document.getElementById('target-device-select') as HTMLSelectElement | null;
    const layout = this.document.getElementById('commands-layout');
    const oldDevice = device?.value, oldLayout = layout?.dataset.activeDevice;
    const modes = Array.from(this.panel(command.key)?.querySelectorAll<HTMLElement>('.pishock-op, .openshock-op') ?? []);
    const activeModes = modes.filter(mode => mode.classList.contains('active'));
    this.applying = true;
    try {
      for (const saved of command.fields) {
        const field = fields.find((field, i) => this.fieldId(field, i) === saved.id)!;
        this.write(field, override?.id === saved.id ? { ...saved, value: override.value } : saved);
      }
      if (override && !command.fields.some(field => field.id === override.id)) {
        const field = fields.find(field => field.id === override.id);
        if (field) field.value = override.value;
      }
      if (device && command.device !== undefined) device.value = command.device;
      if (layout && command.device !== undefined) layout.dataset.activeDevice = command.device;
      if (command.mode !== undefined) for (const mode of modes) mode.classList.toggle('active', (mode.dataset.op ?? mode.dataset.type) === command.mode);
      const Event = this.document.defaultView!.Event;
      for (const field of fields) { field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); }
      button.click();
    } finally {
      if (device && oldDevice !== undefined) device.value = oldDevice;
      if (layout) { if (oldLayout === undefined) delete layout.dataset.activeDevice; else layout.dataset.activeDevice = oldLayout; }
      for (const mode of modes) mode.classList.toggle('active', activeModes.includes(mode));
      this.applying = false; this.restoreDrafts();
    }
  }
  private rememberDrafts(): void {
    for (const key of this.buttons().keys()) for (const [index, field] of this.fields(key).entries()) {
      this.drafts.set(field, this.read(field, this.fieldId(field, index)));
    }
  }
  restoreDrafts(): void {
    for (const [field, draft] of this.drafts) {
      if (!field.isConnected) this.drafts.delete(field);
      else this.write(field, draft);
    }
  }
  mount(send: (command: SendCommand) => void, ready: () => void, error: (message: string) => void): void {
    this.onSend = send;
    const edited = (event: Event) => {
      if (this.applying) return;
      for (const key of this.buttons().keys()) {
        const fields = this.fields(key), index = fields.indexOf(event.target as Field);
        if (index >= 0) this.drafts.set(fields[index]!, this.read(fields[index]!, this.fieldId(fields[index]!, index)));
      }
    };
    this.document.addEventListener('input', edited); this.document.addEventListener('change', edited);
    const observer = new this.document.defaultView!.MutationObserver(records => {
      this.reconcile(error);
      if (records.some(record => record.type === 'attributes' && [...this.buttons().values()].includes(record.target as HTMLButtonElement))) ready();
      // Native send handlers clear fields without input events, including after late replies.
      if (records.some(record => Array.from(record.addedNodes).some(node => node instanceof this.document.defaultView!.Element &&
        (node.matches('.toast') || node.parentElement?.id === 'toast-container')))) this.restoreDrafts();
    });
    observer.observe(this.document, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled'] });
    this.stopObservation = () => { observer.disconnect(); this.document.removeEventListener('input', edited); this.document.removeEventListener('change', edited); };
    this.reconcile(error);
  }
  private reconcile(error: (message: string) => void): void {
    for (const [key, old] of this.replacements) if (!old.native.isConnected) { old.proxy.remove(); this.replacements.delete(key); }
    for (const [key, native] of this.buttons()) {
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
    this.stopObservation?.(); this.restoreDrafts(); this.drafts.clear();
    for (const { native, proxy, hidden } of this.replacements.values()) {
      native.hidden = hidden; native.classList.remove('ctrlem-db-native-send'); proxy.remove();
    }
    this.replacements.clear(); this.onSend = undefined;
  }
}
