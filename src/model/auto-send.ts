import { commandKeys, commands } from './commands';
import type { Item } from './library';

export const autoCommandKeys = [...commandKeys, 'sendOrDelete'] as const;
export type AutoCommandKey = typeof autoCommandKeys[number];
export const autoSendLimits = { defaultSeconds: 3, minSeconds: 3, maxSeconds: 3600, resultTimeoutMs: 15_000, probeTimeoutMs: 2_000 };
export const autoCommandLabel = (key: AutoCommandKey): string => key === 'sendOrDelete' ? 'Send or Delete' : commands[key].label;
export const pauseReasons = {
  unavailable: 'Page or command unavailable. Open the page, then Resume.',
  empty: 'Category is missing or empty. Choose a non-empty category.',
  failed: 'The site reported an error. Check the page, then Resume.',
  unknown: 'Result unknown. Check the page before resuming; the command may have been sent.',
  interrupted: 'Page reloaded or closed. Open the page, then Resume.',
  busy: 'Native Send is busy. Wait, then Resume.',
  storage: 'Couldn’t save task state. Retry the connection before resuming.',
} as const;
export type PauseReason = keyof typeof pauseReasons;
export interface AutoExecution {
  token: string; receiver: string; command: AutoCommandKey; value?: string; deadline: number;
  itemId?: string; selectionRevision: number;
}
export type AutoOutcome = { status: 'success' } | { status: 'paused'; reason: PauseReason };
export interface AutoTask {
  id: string; receiver: string; command: AutoCommandKey; tabId: number;
  categoryId?: string; categoryName: string; intervalSeconds: number;
  status: 'queued' | 'running' | 'stopping' | 'paused'; reason?: PauseReason;
  dueAt: number; orderIds: string[]; nextItemId?: string;
  highlightedItemId?: string; selectionRevision: number;
  execution?: AutoExecution;
}
export interface AutoState { revision: number; nextAllowedAt: number; tasks: AutoTask[] }
export const emptyAutoState = (): AutoState => ({ revision: 0, nextAllowedAt: 0, tasks: [] });

/** Continue in the saved order when the next item was deleted between attempts. */
export function nextAutoItem(task: Pick<AutoTask, 'orderIds' | 'nextItemId'>, items: Item[]): Item | undefined {
  const selected = items.find(item => item.id === task.nextItemId);
  if (selected) return selected;
  const index = task.orderIds.indexOf(task.nextItemId ?? '');
  const remaining = index < 0 ? [] : [...task.orderIds.slice(index + 1), ...task.orderIds.slice(0, index)];
  return remaining.map(id => items.find(item => item.id === id)).find(Boolean) ?? items[0];
}
