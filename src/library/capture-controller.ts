import type { CommandKey } from '../model/commands';
import type { CaptureClient } from '../shared/library-protocol';
import type { CommandFields } from '../site/command-fields';

export class CaptureController {
  private stop?: () => void;
  constructor(private readonly page: CommandFields, private readonly client: CaptureClient,
    private readonly isDefault: (key: CommandKey, value: string) => boolean) {}
  start(): void {
    this.stop = this.page.observeManualSend(field => { this.capture(field.key, field.input.value); });
  }
  accepted(key: CommandKey, value: string): void {
    if (this.page.find().some(field => field.key === key)) this.capture(key, value);
  }
  private capture(key: CommandKey, value: string): void {
    if (this.isDefault(key, value)) return;
    // Capture is silent and must never interrupt sending, including on storage failure.
    void this.client.capture(key, value).catch(() => undefined);
  }
  dispose(): void { this.stop?.(); }
}
