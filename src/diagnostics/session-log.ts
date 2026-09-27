import { z } from '../shared/validation';
import { commandKeys } from '../model/commands';

export const diagnosticLimits = { maxBytes: 5 * 1024 * 1024, maxEntries: 8192, headerBytes: 4096 };
const events = ['session.start', 'session.end', 'upload', 'library', 'auto.request', 'auto.execute',
  'files.import', 'files.prepare', 'files.operation', 'native.send', 'site.error', 'log.export'] as const;
const commands = [...commandKeys, 'sendOrDelete', 'session', 'other'] as const;
const mimes = ['image/gif', 'image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/bmp', 'video/mp4', 'audio/mpeg', 'other'] as const;
const codes = ['unknown', 'network', 'http', 'invalid-response', 'interrupted', 'file-read', 'unavailable',
  'timeout', 'permission', 'quota', 'validation', 'decode', 'rate-limit', 'image-body-decode', 'image-body-read', 'stream-error', 'site-rejected'] as const;
const number = z.number().finite().nonnegative().optional();
const browserErrorPattern = /^(?:NS_ERROR_[A-Z0-9_]+|net::ERR_[A-Z0-9_]+)$/;
// Only enums, browser symbolic codes, numbers and booleans cross this boundary. No arbitrary error text,
// filenames, library contents, recipient IDs, media URLs or credentials are retained.
const detailsSchema = z.object({
  outcome: z.enum(['start', 'success', 'failed', 'paused', 'cancelled', 'conflict']).optional(),
  durationMs: number, bytes: number, inputBytes: number, outputBytes: number, count: number,
  width: number, height: number, frames: number, status: number, retryAfterMs: number,
  command: z.enum(commands).optional(), mime: z.enum(mimes).optional(),
  provider: z.enum(['imgbb', 'catbox', 'vidhosting']).optional(),
  code: z.enum(codes).optional(),
  stage: z.enum(['access', 'settings', 'page', 'token', 'upload', 'response', 'transfer', 'decode', 'resize', 'encode']).optional(),
  reason: z.enum(['unavailable', 'empty', 'failed', 'invalid', 'unknown', 'interrupted', 'busy', 'storage', 'file']).optional(),
  failureCode: z.enum(['rateLimit', 'required', 'url', 'textLength', 'count', 'session', 'rejected']).optional(),
  request: z.enum(['library:load', 'library:change', 'library:capture', 'library:import', 'library:add-upload', 'library:session',
    'picker:load', 'picker:select', 'auto:snapshot', 'auto:start', 'auto:stop', 'auto:seek', 'auto:stop-all', 'auto:resume',
    'auto:open', 'auto:manual', 'auto:enqueue', 'auto:ready', 'auto:claim', 'auto:dismiss', 'auto:detach',
    'files:list', 'files:gallery', 'files:progress', 'files:clear', 'files:preferences']).optional(),
  observation: z.enum(['observed', 'not-observed', 'unavailable', 'ambiguous']).optional(),
  hostPermission: z.enum(['granted', 'missing', 'unknown']).optional(),
  observerPermission: z.enum(['granted', 'missing', 'unknown']).optional(),
  browserError: z.string().max(96).regex(browserErrorPattern).optional(),
  redirected: z.boolean().optional(), anonymous: z.boolean().optional(), originMissing: z.boolean().optional(), existing: z.boolean().optional(),
});
export type DiagnosticDetails = z.infer<typeof detailsSchema>;
export type DiagnosticEvent = typeof events[number];
export interface DiagnosticEnvironment { extensionVersion: string; browser: 'Edge' | 'Firefox' | 'other'; browserMajor?: number; page: 'profile' | 'group' | 'other' }

export class SessionLog {
  private readonly entries = new Array<string | undefined>(diagnosticLimits.maxEntries);
  private head = 0;
  private count = 0;
  private retainedBytes = 0;
  private dropped = 0;
  private readonly startedAt = new Date().toISOString();
  private readonly sessionId = crypto.randomUUID();
  constructor(private readonly environment: DiagnosticEnvironment, private readonly maxBytes = diagnosticLimits.maxBytes) {}

  record(event: DiagnosticEvent, details: DiagnosticDetails = {}): void {
    const parsed = detailsSchema.safeParse(details);
    if (!parsed.success || !events.includes(event)) return;
    const line = `${JSON.stringify({ at: new Date().toISOString(), event, ...parsed.data })}\n`;
    // All accepted values are ASCII. Account for UTF-16 backing storage too;
    // export itself is smaller than the memory budget, including its header.
    const bytes = line.length * 2;
    const budget = this.maxBytes - diagnosticLimits.headerBytes;
    if (bytes > budget) { this.dropped++; return; }
    while (this.count && (this.retainedBytes + bytes > budget || this.count === this.entries.length)) {
      this.retainedBytes -= this.entries[this.head]!.length * 2;
      this.entries[this.head] = undefined;
      this.head = (this.head + 1) % this.entries.length;
      this.count--; this.dropped++;
    }
    this.entries[(this.head + this.count) % this.entries.length] = line;
    this.count++; this.retainedBytes += bytes;
  }

  export(): string {
    const header = JSON.stringify({ format: 'ctrlem-db-session-log', version: 1, sessionId: this.sessionId,
      startedAt: this.startedAt, exportedAt: new Date().toISOString(),
      extensionVersion: /^\d+(?:\.\d+){0,3}$/.test(this.environment.extensionVersion) ? this.environment.extensionVersion : 'unknown',
      browser: ['Edge', 'Firefox'].includes(this.environment.browser) ? this.environment.browser : 'other',
      browserMajor: Number.isInteger(this.environment.browserMajor) && this.environment.browserMajor! > 0 && this.environment.browserMajor! < 10000 ? this.environment.browserMajor : undefined,
      page: ['profile', 'group'].includes(this.environment.page) ? this.environment.page : 'other',
      droppedEntries: this.dropped, retainedEntries: this.count, maxBytes: this.maxBytes });
    const lines = Array.from({ length: this.count }, (_, index) => this.entries[(this.head + index) % this.entries.length]!);
    return `${header}\n${lines.join('')}`;
  }
}

let session: SessionLog | undefined;
export function startDiagnosticSession(document: Document, version: string): void {
  const agent = document.defaultView!.navigator.userAgent;
  session = new SessionLog({ extensionVersion: /^\d+(?:\.\d+){0,3}$/.test(version) ? version : 'unknown',
    browser: agent.includes('Edg/') ? 'Edge' : agent.includes('Firefox/') ? 'Firefox' : 'other',
    browserMajor: Number(/(?:Edg|Firefox)\/(\d+)/.exec(agent)?.[1]) || undefined,
    page: document.location.pathname.startsWith('/groups/') ? 'group' : document.location.pathname.startsWith('/u/') ? 'profile' : 'other' });
  recordDiagnostic('session.start');
}
export function recordDiagnostic(event: DiagnosticEvent, details: DiagnosticDetails = {}): void { session?.record(event, details); }
export function exportDiagnosticLog(): string {
  recordDiagnostic('log.export');
  return session?.export() ?? new SessionLog({ extensionVersion: 'unknown', browser: 'other', page: 'other' }).export();
}
export function diagnosticMime(value: string): typeof mimes[number] { return mimes.find(mime => mime === value) ?? 'other'; }
export function diagnosticCommand(value: string): typeof commands[number] { return commands.find(command => command === value) ?? 'other'; }
export function diagnosticBrowserError(value: string | undefined): string | undefined {
  return value && value.length <= 96 && browserErrorPattern.test(value) ? value : undefined;
}
export function classifyDiagnosticError(error: unknown): typeof codes[number] {
  const message = error instanceof Error ? `${error.name} ${error.message}` : '';
  if (/abort|interrupt|disconnect|cancel/i.test(message)) return 'interrupted';
  if (/timeout|timed out/i.test(message)) return 'timeout';
  if (/quota/i.test(message)) return 'quota';
  if (/permission|access denied/i.test(message)) return 'permission';
  if (/rate limit/i.test(message)) return 'rate-limit';
  if (/HTTP \d{3}|failed \(\d{3}\)/i.test(message)) return 'http';
  if (/fetch|network|connection/i.test(message)) return 'network';
  if (/decode|corrupt/i.test(message)) return 'decode';
  if (/invalid|validation/i.test(message)) return 'validation';
  return 'unknown';
}
