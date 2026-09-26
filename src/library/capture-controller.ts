import type { CommandKey } from '../model/commands';
import type { CaptureClient } from '../shared/library-protocol';
import type { CommandFields, CommandField } from '../site/command-fields';

interface CaptureState { element: HTMLElement; sequence: number }
export class CaptureController {
  private stop?: () => void;
  private readonly states = new Map<CommandKey, CaptureState>();
  private disposed = false;
  constructor(private readonly page: CommandFields, private readonly client: CaptureClient,
    private readonly isDefault: (key: CommandKey, value: string) => boolean) {}
  start(): void {
    this.stop = this.page.observeManualSend(field => {
      const value = field.input.value;
      const state = this.states.get(field.key);
      if (state) { state.sequence++; state.element.replaceChildren(); }
      if (!this.isDefault(field.key, value)) void this.capture(field, value);
    });
  }
  accepted(key: CommandKey, value: string): void {
    const field = this.page.find().find(field => field.key === key);
    if (field && !this.isDefault(key, value)) void this.capture(field, value);
  }
  private async capture(field: CommandField, value: string): Promise<void> {
    let state = this.states.get(field.key);
    if (!state) {
      const element = this.page.document.createElement('div');
      element.className = 'ctrlem-db-capture'; element.setAttribute('role', 'status');
      state = { element, sequence: 0 }; this.states.set(field.key, state);
    }
    field.input.before(state.element);
    const sequence = ++state.sequence;
    state.element.replaceChildren();
    try {
      const result = await this.client.capture(field.key, value);
      if (!this.disposed && state.sequence === sequence) state.element.textContent = result.status === 'saved' ? 'Added to Input' : '';
    } catch {
      if (this.disposed || state.sequence !== sequence) return;
      state.element.textContent = 'Couldn’t add to Input. ';
      const retry = this.page.document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry';
      retry.addEventListener('click', () => { void this.capture(field, value); }); state.element.append(retry);
    }
  }
  dispose(): void { this.disposed = true; this.stop?.(); for (const state of this.states.values()) state.element.remove(); }
}
