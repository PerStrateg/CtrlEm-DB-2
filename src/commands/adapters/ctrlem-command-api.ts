import type { AutoExecution, AutoOutcome, SendFailureCode } from '../../model/auto-send';
import { reportTabDiagnostic } from '../../diagnostics/relay';
import { apiCommandKey, serializeApiCommand, type ApiCommandKey } from '../domain/api-command';
import type { CommandApiPort } from '../ports/command-api-port';

export const commandApiLimits = { timeoutMs: 15_000 } as const;

export interface CommandApiDiagnostic {
  event: 'start' | 'response' | 'failure';
  requestId: string;
  receiverKind: 'group' | 'user';
  command: ApiCommandKey;
  durationMs?: number;
  status?: number;
  code?: 'http' | 'network' | 'timeout' | 'validation';
  retryAfterMs?: number;
}

export type CommandApiReporter = (diagnostic: CommandApiDiagnostic) => void;

function retryAfter(response: Response, now: number): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : undefined;
}

export class CtrlemCommandApiAdapter implements CommandApiPort {
  constructor(private readonly request: typeof fetch, private readonly report: CommandApiReporter,
    private readonly now = Date.now) {}

  async execute(execution: AutoExecution): Promise<AutoOutcome> {
    const command = apiCommandKey(execution.command);
    const receiverKind = execution.receiver.startsWith('group:') ? 'group' : 'user';
    if (!command) return { status: 'paused', reason: 'invalid', failureCode: 'rejected' };
    const serialized = serializeApiCommand(execution);
    if (!serialized.ok) return this.invalid(execution, receiverKind, command, serialized.failureCode);

    const requestId = execution.token, startedAt = this.now();
    this.report({ event: 'start', requestId, receiverKind, command });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), commandApiLimits.timeoutMs);
    try {
      const groupId = receiverKind === 'group' ? execution.receiver.slice('group:'.length) : undefined;
      const targetDevice = execution.parameters?.device || undefined;
      const body = groupId ? { command: serialized.value, targetDevice } :
        { controlCode: execution.receiver.toUpperCase(), command: serialized.value, targetDevice };
      const request = this.request;
      const response = await request(groupId
        ? `https://ctrlem.com/api/groups/${encodeURIComponent(groupId)}/command`
        : 'https://ctrlem.com/api/command', {
        method: 'POST', credentials: 'include', cache: 'no-store', signal: controller.signal,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const durationMs = this.now() - startedAt;
      if (response.ok) {
        this.report({ event: 'response', requestId, receiverKind, command, status: response.status, durationMs });
        return { status: 'success' };
      }
      const retryAfterMs = retryAfter(response, this.now());
      this.report({ event: 'failure', requestId, receiverKind, command, status: response.status,
        durationMs, code: 'http', retryAfterMs });
      return response.status === 429 || response.status >= 500
        ? { status: 'paused', reason: 'failed', failureCode: response.status === 429 ? 'rateLimit' : 'rejected', retryAfterMs }
        : { status: 'paused', reason: 'invalid', failureCode: 'rejected' };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      this.report({ event: 'failure', requestId, receiverKind, command, durationMs: this.now() - startedAt,
        code: timedOut ? 'timeout' : 'network' });
      return { status: 'paused', reason: 'failed', failureCode: 'rejected' };
    } finally { clearTimeout(timeout); }
  }

  private invalid(execution: AutoExecution, receiverKind: 'group' | 'user', command: ApiCommandKey,
    failureCode: SendFailureCode): AutoOutcome {
    this.report({ event: 'failure', requestId: execution.token, receiverKind, command, code: 'validation' });
    return { status: 'paused', reason: 'invalid', failureCode };
  }
}

export function reportCommandApi(diagnostic: CommandApiDiagnostic): void {
  const method = diagnostic.event === 'failure' ? 'warn' : 'info';
  console[method]('[CtrlEm DB][command-api]', diagnostic);
  const details = {
    requestId: diagnostic.requestId, receiverKind: diagnostic.receiverKind, command: diagnostic.command,
    outcome: diagnostic.event === 'start' ? 'start' as const : diagnostic.event === 'response' ? 'success' as const : 'failed' as const,
    durationMs: diagnostic.durationMs, status: diagnostic.status, code: diagnostic.code,
    retryAfterMs: diagnostic.retryAfterMs,
  };
  void chrome.tabs.query({ url: ['https://ctrlem.com/u/*', 'https://ctrlem.com/groups/*'] }).then(tabs => {
    for (const tab of tabs) if (tab.id !== undefined) reportTabDiagnostic(tab.id, 'command.api', details);
  }).catch(() => console.warn('[CtrlEm DB][command-api]', { event: 'diagnostic-relay-failure' }));
}
