import type { AutoClient, AutoRequest, AutoSnapshot } from '../shared/auto-send-protocol';
import { AutoConnectionError } from '../shared/auto-send-protocol';
import type { AutoExecution } from '../model/auto-send';
import type { AutoSendPage } from '../site/auto-send-page';

export class ExtensionAutoClient implements AutoClient {
  async request(request: AutoRequest): Promise<AutoSnapshot> {
    let response: { ok: boolean; value: AutoSnapshot; error?: string };
    try { response = await chrome.runtime.sendMessage(request); }
    catch { throw new AutoConnectionError('Connection lost. Retry.'); }
    if (!response) throw new AutoConnectionError('Connection lost. Retry.');
    if (!response?.ok) throw new Error(response?.error ?? 'Connection lost. Retry.');
    return response.value;
  }
  subscribe(changed: (snapshot: AutoSnapshot | undefined) => void): () => void {
    const listener = (message: { type?: string; snapshot?: AutoSnapshot }, sender: chrome.runtime.MessageSender) => {
      if (sender.id === chrome.runtime.id && !sender.tab && message.type === 'auto:changed') changed(message.snapshot);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }
}

export function bindAutoExecutor(page: AutoSendPage): () => void {
  const listener = (message: { type?: string; execution: AutoExecution }, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    if (message.type === 'auto:probe') { respond(page.state()); return false; }
    if (message.type !== 'auto:execute') return false;
    void page.execute(message.execution).then(respond, () => respond({ status: 'paused', reason: 'unknown' }));
    return true;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
