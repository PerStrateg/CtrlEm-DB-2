import { recordDiagnostic } from './session-log';
import type { DiagnosticDetails, DiagnosticEvent } from './session-log';

/** Background work reports to the initiating tab's in-memory session. */
export function reportTabDiagnostic(tabId: number, event: DiagnosticEvent, details: DiagnosticDetails): void {
  void chrome.tabs.sendMessage(tabId, { type: 'diagnostics:event', event, details }, { frameId: 0 }).catch(() => undefined);
}

export function bindDiagnosticRelay(): () => void {
  const listener = (message: { type?: string; event: DiagnosticEvent; details: DiagnosticDetails }, sender: chrome.runtime.MessageSender) => {
    if (sender.id === chrome.runtime.id && !sender.tab && message.type === 'diagnostics:event') {
      recordDiagnostic(message.event, message.details);
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
