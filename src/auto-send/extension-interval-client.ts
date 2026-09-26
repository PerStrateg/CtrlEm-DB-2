import { intervalsKey } from '../shared/interval-protocol';
import type { IntervalClient, Intervals } from '../shared/interval-protocol';
import type { AutoCommandKey } from '../model/auto-send';

export class ExtensionIntervalClient implements IntervalClient {
  private async request(message: { type: string; command?: AutoCommandKey; seconds?: number }): Promise<Intervals> {
    const reply = await chrome.runtime.sendMessage(message);
    if (!reply?.ok) throw new Error('Couldn’t save interval. Retry.');
    return reply.value;
  }
  load(): Promise<Intervals> { return this.request({ type: 'interval:load' }); }
  async save(command: AutoCommandKey, seconds: number): Promise<void> { await this.request({ type: 'interval:save', command, seconds }); }
  subscribe(changed: (values: Intervals) => void): () => void {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[intervalsKey]) changed(changes[intervalsKey].newValue ?? {});
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
}
