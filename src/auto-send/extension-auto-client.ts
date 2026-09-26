import type { AutoClient, AutoRequest, AutoSnapshot } from '../shared/auto-send-protocol';
import { AutoConnectionError } from '../shared/auto-send-protocol';
import type { AutoExecution } from '../model/auto-send';
import type { AutoSendPage } from '../site/auto-send-page';

export class ExtensionAutoClient implements AutoClient {
  async request(request: AutoRequest): Promise<AutoSnapshot> {
    let response: { ok: boolean; value: AutoSnapshot; error?: string };
    try { response = await chrome.runtime.sendMessage(request); }
    catch { throw new AutoConnectionError('Couldn’t update the queue. Try again.'); }
    if (!response) throw new AutoConnectionError('Couldn’t update the queue. Try again.');
    if (!response?.ok) throw new Error(response?.error ?? 'Couldn’t update the queue. Try again.');
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
  const listener = (message: { type?: string; execution: AutoExecution; snapshot?: AutoSnapshot }, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    if (message.type === 'auto:changed') { page.synchronize(message.snapshot); return false; }
    if (message.type === 'auto:probe') { respond(page.state()); return false; }
    if (message.type !== 'auto:execute') return false;
    void chrome.runtime.sendMessage({ type: 'auto:claim', token: message.execution.token }).then(async (reply: { ok: boolean; value?: AutoSnapshot }) => {
      const snapshot = reply.value;
      const allowed = reply.ok && snapshot && [...snapshot.tasks, ...snapshot.sends].some(entry =>
        entry.status === 'running' && entry.execution?.token === message.execution.token);
      return allowed ? page.execute(message.execution) : { status: 'paused', reason: 'interrupted' };
    }).then(respond, () => respond({ status: 'paused', reason: 'unknown' }));
    return true;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
