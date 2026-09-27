import type { AutoClient, AutoRequest, AutoSnapshot } from '../shared/auto-send-protocol';
import { AutoConnectionError } from '../shared/auto-send-protocol';
import type { AutoExecution, AutoOutcome } from '../model/auto-send';
import type { AutoSendPage } from '../site/auto-send-page';
import { classifyDiagnosticError, diagnosticCommand, recordDiagnostic } from '../diagnostics/session-log';

export class ExtensionAutoClient implements AutoClient {
  async request(request: AutoRequest): Promise<AutoSnapshot> {
    const started = performance.now();
    let response: { ok: boolean; value: AutoSnapshot; error?: string };
    try { response = await chrome.runtime.sendMessage(request); }
    catch (error) {
      recordDiagnostic('auto.request', { request: request.type, outcome: 'failed', code: classifyDiagnosticError(error), durationMs: Math.round(performance.now() - started) });
      throw new AutoConnectionError('Couldn’t update the queue. Try again.');
    }
    if (!response?.ok) {
      recordDiagnostic('auto.request', { request: request.type, outcome: 'failed', code: response ? 'unknown' : 'interrupted', durationMs: Math.round(performance.now() - started) });
      if (!response) throw new AutoConnectionError('Couldn’t update the queue. Try again.');
      throw new Error(response.error ?? 'Couldn’t update the queue. Try again.');
    }
    if (!['auto:snapshot', 'auto:ready'].includes(request.type)) recordDiagnostic('auto.request', {
      request: request.type, outcome: 'success', durationMs: Math.round(performance.now() - started),
      command: 'command' in request ? diagnosticCommand(request.command) : 'parameters' in request ? diagnosticCommand(request.parameters.key) : undefined,
    });
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
    const started = performance.now();
    const command = diagnosticCommand(message.execution.command);
    recordDiagnostic('auto.execute', { command, outcome: 'start' });
    void chrome.runtime.sendMessage({ type: 'auto:claim', token: message.execution.token }).then(async (reply: { ok: boolean; value?: AutoSnapshot }): Promise<AutoOutcome> => {
      const snapshot = reply.value;
      const allowed = reply.ok && snapshot && [...snapshot.tasks, ...snapshot.sends].some(entry =>
        entry.status === 'running' && !entry.execution?.sourceInvalidated && entry.execution?.token === message.execution.token);
      return allowed ? page.execute(message.execution) : { status: 'paused', reason: 'interrupted' };
    }).then(outcome => {
      recordDiagnostic('auto.execute', { command, outcome: outcome.status === 'success' ? 'success' : 'paused',
        durationMs: Math.round(performance.now() - started),
        reason: outcome.status === 'paused' ? outcome.reason : undefined });
      respond(outcome);
    }, error => {
      recordDiagnostic('auto.execute', { command, outcome: 'failed', code: classifyDiagnosticError(error), durationMs: Math.round(performance.now() - started) });
      respond({ status: 'paused', reason: 'unknown' });
    });
    return true;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
