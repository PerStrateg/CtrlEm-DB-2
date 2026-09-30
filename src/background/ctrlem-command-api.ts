import type { AutoExecution, AutoOutcome } from '../model/auto-send';
import { commands, type CommandKey } from '../model/commands';
import { reportTabDiagnostic } from '../diagnostics/relay';

export const commandApiLimits = { timeoutMs: 15_000 } as const;
const supportedCommands = ['popupImage', 'changeWallpaper', 'videoOverlay'] as const satisfies readonly CommandKey[];
type SupportedCommand = typeof supportedCommands[number];

export interface CommandApiDiagnostic {
  event: 'start' | 'response' | 'failure';
  requestId: string;
  receiverKind: 'group' | 'user';
  command: SupportedCommand;
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

function commandValue(execution: AutoExecution, command: SupportedCommand): string | undefined {
  return execution.value ?? execution.parameters?.fields.find(field => field.id === commands[command].fieldId)?.value;
}

export class CtrlemCommandApiAdapter {
  constructor(private readonly request: typeof fetch, private readonly report: CommandApiReporter,
    private readonly now = Date.now) {}

  async execute(execution: AutoExecution): Promise<AutoOutcome> {
    const command = supportedCommands.find(value => value === execution.command);
    const receiverKind = execution.receiver.startsWith('group:') ? 'group' : 'user';
    if (!command) return this.invalid(execution, receiverKind);
    const value = commandValue(execution, command);
    if (!value || !this.validUrl(value)) return this.invalid(execution, receiverKind, command);

    const requestId = execution.token, startedAt = this.now();
    this.report({ event: 'start', requestId, receiverKind, command });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), commandApiLimits.timeoutMs);
    try {
      const groupId = receiverKind === 'group' ? execution.receiver.slice('group:'.length) : undefined;
      const request = this.request;
      const response = await request(groupId ? `https://ctrlem.com/api/groups/${encodeURIComponent(groupId)}/command` : 'https://ctrlem.com/api/command', {
        method: 'POST', credentials: 'include', cache: 'no-store', signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(groupId ? { command: `${command} ${value}` } :
          { controlCode: execution.receiver.toUpperCase(), command: `${command} ${value}` }),
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

  private validUrl(value: string): boolean {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  }

  private invalid(execution: AutoExecution, receiverKind: 'group' | 'user', command: SupportedCommand = 'popupImage'): AutoOutcome {
    this.report({ event: 'failure', requestId: execution.token, receiverKind, command, code: 'validation' });
    return { status: 'paused', reason: 'invalid', failureCode: 'url' };
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
    for (const tab of tabs) if (tab.id !== undefined) reportTabDiagnostic(tab.id, 'media.api', details);
  }).catch(() => console.warn('[CtrlEm DB][command-api]', { event: 'diagnostic-relay-failure' }));
}
