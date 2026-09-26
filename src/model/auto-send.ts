import { commandKeys, commands } from './commands';
import type { SendCommand } from './send-command';
import { sendQueueLimits } from './send-command';

export const autoCommandKeys = [...commandKeys, 'sendOrDelete'] as const;
export type AutoCommandKey = typeof autoCommandKeys[number];
export const autoSendLimits = { defaultSeconds: 3, minSeconds: 3, maxSeconds: 3600, resultTimeoutMs: 15_000, probeTimeoutMs: 2_000 };
export const autoCommandLabel = (key: AutoCommandKey): string => key === 'sendOrDelete' ? 'Send or Delete' : commands[key].label;
export const pauseReasons = {
  unavailable: 'Page or command unavailable. Open the page, then Resume.',
  empty: 'Category is missing or empty. Choose a non-empty category.',
  failed: 'The site reported an error. Check the page, then Resume.',
  invalid: 'Cancel or stop this task, correct the command, then send again.',
  unknown: 'Result unknown. Check the page before resuming; the command may have been sent.',
  interrupted: 'Page reloaded or closed. Open the page, then Resume.',
  busy: 'Wait a moment, then Resume.',
  storage: '',
  file: 'Could not prepare or upload the image. Check Files, then Resume.',
} as const;
export type PauseReason = keyof typeof pauseReasons;
export interface AutoExecution {
  sourceInvalidated?: boolean;
  token: string; receiver: string; command: string; value?: string; deadline: number;
  parameters?: SendCommand;
  itemId?: string; selectionRevision: number;
}
export const sendFailureMessages = {
  rateLimit: 'The site asked you to wait before sending.',
  required: 'A required command value is missing.',
  url: 'The command needs a valid HTTP or HTTPS URL.',
  textLength: 'Write For Me text must be 200 characters or less.',
  count: 'Write For Me count must be between 1 and 5.',
  session: 'A session is already in progress.',
  rejected: 'The site rejected this command. Check its settings.',
} as const;
export type SendFailureCode = keyof typeof sendFailureMessages;
export type AutoOutcome = { status: 'success' } | { status: 'paused'; reason: PauseReason; retryAfterMs?: number; failureCode?: SendFailureCode };
export interface AutoTask {
  source?: 'files';
  preparation?: { token: string; itemId: string };
  preparedItemId?: string;
  fileError?: string;
  id: string; receiver: string; command: AutoCommandKey; tabId: number;
  categoryId?: string; categoryName: string; intervalSeconds: number;
  status: 'queued' | 'running' | 'stopping' | 'paused'; reason?: PauseReason;
  dueAt: number; orderIds: string[]; nextItemId?: string;
  readinessAt?: number;
  highlightedItemId?: string; selectionRevision: number;
  execution?: AutoExecution;
  parameters?: SendCommand;
  retryCount?: number;
  failureCode?: SendFailureCode;
  retryExecution?: AutoExecution;
}
export interface ManualSend {
  source?: 'files'; fileId?: string;
  preparation?: { token: string; itemId: string };
  preparedItemId?: string;
  fileError?: string;
  id: string; receiver: string; tabId: number; parameters: SendCommand;
  status: AutoTask['status']; reason?: PauseReason; dueAt: number; sequence: number;
  retryCount: number; execution?: AutoExecution;
  readinessAt?: number;
  failureCode?: SendFailureCode;
}
export interface SendNotice { id: string; receiver: string; label: string; message: string }
export interface AutoState {
  revision: number; nextAllowedAt: number; groupAllowedAt: number;
  tasks: AutoTask[]; sends: ManualSend[]; acceptedRequests: { id: string; expiresAt: number }[]; notices: SendNotice[]; sequence: number;
}
export const emptyAutoState = (): AutoState => ({ revision: 0, nextAllowedAt: 0, groupAllowedAt: 0,
  tasks: [], sends: [], acceptedRequests: [], notices: [], sequence: 0 });

export type QueueEntry = AutoTask | ManualSend;
export const isManualSend = (entry: QueueEntry): entry is ManualSend => 'sequence' in entry;
export const queueAvailableAt = (entry: QueueEntry, state: Pick<AutoState, 'nextAllowedAt' | 'groupAllowedAt'>): number => Math.max(entry.dueAt,
  entry.readinessAt ?? 0, state.nextAllowedAt, entry.receiver.startsWith('group:') ? state.groupAllowedAt : 0);
export function orderedQueue(state: Pick<AutoState, 'tasks' | 'sends' | 'nextAllowedAt' | 'groupAllowedAt'>, now: number): QueueEntry[] {
  const rank = (entry: QueueEntry) => entry.execution ? 0 : entry.status === 'paused' ? 4 :
    queueAvailableAt(entry, state) > now ? 3 : isManualSend(entry) ? 1 : 2;
  return [...state.sends, ...state.tasks].sort((a, b) => rank(a) - rank(b) ||
    (rank(a) === 3 ? queueAvailableAt(a, state) - queueAvailableAt(b, state) :
      isManualSend(a) && isManualSend(b) ? a.sequence - b.sequence : a.dueAt - b.dueAt));
}

/** Estimate dispatch times assuming immediate successful site replies. Repeats consume queue slots too. */
export function projectedSendTimes(state: Pick<AutoState, 'tasks' | 'sends' | 'nextAllowedAt' | 'groupAllowedAt'>, now: number): Map<string, number> {
  const times = new Map<string, number>();
  // An in-flight request has no known completion time. Recalculate when its result arrives.
  if ([...state.tasks, ...state.sends].some(entry => entry.execution)) return times;
  const pending = (entry: QueueEntry) => entry.status === 'queued' && entry.reason !== 'busy' && !entry.preparation;
  const projected = {
    tasks: state.tasks.filter(pending).map(entry => ({ ...entry })),
    sends: state.sends.filter(pending).map(entry => ({ ...entry })),
    nextAllowedAt: state.nextAllowedAt, groupAllowedAt: state.groupAllowedAt,
  };
  const count = projected.tasks.length + projected.sends.length;
  let cursor = now;
  while (times.size < count) {
    let entry = orderedQueue(projected, cursor)[0]!;
    cursor = Math.max(cursor, queueAvailableAt(entry, projected));
    // Eligibility changes at this time; ready manual sends take precedence.
    entry = orderedQueue(projected, cursor)[0]!;
    if (!times.has(entry.id)) times.set(entry.id, cursor);
    projected.nextAllowedAt = cursor + sendQueueLimits.userMs;
    if (entry.receiver.startsWith('group:')) projected.groupAllowedAt = cursor + sendQueueLimits.groupMs;
    if (isManualSend(entry)) projected.sends = projected.sends.filter(send => send.id !== entry.id);
    else { entry.dueAt = cursor + entry.intervalSeconds * 1000; delete entry.readinessAt; }
  }
  return times;
}

/** Continue in the saved order when the next item was deleted between attempts. */
export function nextAutoItem<T extends { id: string }>(task: Pick<AutoTask, 'orderIds' | 'nextItemId'>, items: T[]): T | undefined {
  const selected = items.find(item => item.id === task.nextItemId);
  if (selected) return selected;
  const index = task.orderIds.indexOf(task.nextItemId ?? '');
  const remaining = index < 0 ? [] : [...task.orderIds.slice(index + 1), ...task.orderIds.slice(0, index)];
  return remaining.map(id => items.find(item => item.id === id)).find(Boolean) ?? items[0];
}
