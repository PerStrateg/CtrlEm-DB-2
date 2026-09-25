import { autoCommandLabel, autoSendLimits, pauseReasons } from '../model/auto-send';
import type { AutoCommandKey, AutoTask } from '../model/auto-send';
import type { AutoSnapshot } from '../shared/auto-send-protocol';

function text(element: HTMLElement, value: string): void { if (element.textContent !== value) element.textContent = value; }
function attribute(element: HTMLElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
function flag(element: HTMLElement, name: 'hidden' | 'disabled', value: boolean): void {
  if (element.hasAttribute(name) !== value) element.toggleAttribute(name, value);
}
function button(document: Document, label: string, action: () => void): HTMLButtonElement {
  const element = document.createElement('button'); element.type = 'button';
  element.textContent = label; element.addEventListener('click', action); return element;
}
function taskStatus(task: AutoTask, nextAllowedAt: number, now: number): string {
  if (task.status === 'paused') return `Paused · ${pauseReasons[task.reason!]}`;
  if (task.status === 'stopping') return 'Stopping… The command already sent cannot be recalled.';
  if (task.status === 'running') return 'Waiting for the site…';
  return `Next in ${Math.max(0, Math.ceil((Math.max(task.dueAt, nextAllowedAt) - now) / 1000))} sec`;
}
export class AutoSendControl {
  readonly element: HTMLElement;
  readonly interval: HTMLInputElement;
  private readonly toggle: HTMLButtonElement;
  constructor(document: Document, key: AutoCommandKey, actions: { toggle(): void }) {
    this.element = document.createElement('div'); this.element.className = 'ctrlem-db-auto-control';
    this.interval = document.createElement('input'); this.interval.type = 'number';
    this.interval.min = String(autoSendLimits.minSeconds); this.interval.max = String(autoSendLimits.maxSeconds);
    this.interval.step = '1'; this.interval.value = String(autoSendLimits.defaultSeconds);
    this.interval.required = true;
    this.interval.setAttribute('aria-label', `${autoCommandLabel(key)} auto-send interval in seconds (${autoSendLimits.minSeconds}–${autoSendLimits.maxSeconds})`);
    this.interval.title = `Auto-send interval in seconds (${autoSendLimits.minSeconds}–${autoSendLimits.maxSeconds})`;
    this.toggle = button(document, 'A', actions.toggle);
    this.toggle.className = 'ctrlem-db-auto-toggle';
    this.element.append(this.interval, this.toggle);
  }
  render(task: AutoTask | undefined, pending: string | undefined, connected: boolean): void {
    const action = pending ?? (task?.status === 'paused' ? 'Resume auto-send' : task ? 'Stop auto-send' : 'Start auto-send');
    attribute(this.toggle, 'title', action); attribute(this.toggle, 'aria-label', action);
    attribute(this.toggle, 'aria-pressed', String(Boolean(task && task.status !== 'paused')));
    attribute(this.toggle, 'aria-busy', String(Boolean(pending || task?.status === 'stopping')));
    flag(this.toggle, 'disabled', Boolean(pending) || task?.status === 'stopping' || !connected);
    flag(this.interval, 'disabled', Boolean(task || pending));
    if (task && this.interval.value !== String(task.intervalSeconds)) this.interval.value = String(task.intervalSeconds);
  }
}
interface TaskRow { element: HTMLElement; title: HTMLElement; source: HTMLElement; status: HTMLElement; stop: HTMLButtonElement; resume: HTMLButtonElement; open: HTMLButtonElement }
export class AutoTaskPanel {
  readonly element: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly collapse: HTMLButtonElement;
  private readonly stopAll: HTMLButtonElement;
  private readonly retry: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly list: HTMLElement;
  private readonly rows = new Map<string, TaskRow>();
  private collapsed = false;
  constructor(private readonly document: Document, private readonly actions: {
    stop(id: string): void; resume(id: string): void; open(id: string): void; stopAll(): void; retry(): void;
  }) {
    this.element = document.createElement('section'); this.element.className = 'ctrlem-db-auto-panel ctrlem-db-ui';
    this.element.setAttribute('aria-label', 'Auto-send tasks');
    const header = document.createElement('header');
    this.heading = document.createElement('strong'); this.heading.tabIndex = -1;
    this.list = document.createElement('div'); this.list.className = 'ctrlem-db-auto-tasks';
    this.collapse = button(document, '⌄', () => {
      this.collapsed = !this.collapsed; this.list.hidden = this.collapsed;
      text(this.collapse, this.collapsed ? '⌃' : '⌄'); this.collapse.setAttribute('aria-expanded', String(!this.collapsed));
      this.collapse.title = this.collapsed ? 'Expand tasks' : 'Collapse tasks';
      this.collapse.setAttribute('aria-label', this.collapse.title);
    });
    this.collapse.className = 'ctrlem-db-auto-collapse'; this.collapse.title = 'Collapse tasks';
    this.collapse.setAttribute('aria-label', 'Collapse tasks');
    this.collapse.setAttribute('aria-expanded', 'true');
    this.stopAll = button(document, 'Stop all', actions.stopAll);
    this.retry = button(document, 'Retry', actions.retry);
    this.status = document.createElement('p'); this.status.setAttribute('role', 'status');
    const notice = document.createElement('div'); notice.className = 'ctrlem-db-auto-notice'; notice.append(this.status, this.retry);
    header.append(this.heading, this.collapse, this.stopAll); this.element.append(header, notice, this.list);
  }
  render(snapshot: AutoSnapshot, connected: boolean, pending: ReadonlyMap<string, string>, error?: string): void {
    const panelHadFocus = this.element.contains(this.document.activeElement);
    flag(this.element, 'hidden', !snapshot.tasks.length && connected && !error);
    if (this.element.hidden && panelHadFocus) {
      const visibleControl = Array.from(this.document.querySelectorAll<HTMLButtonElement>('.ctrlem-db-auto-control button'))
        .find(button => !button.disabled && button.getClientRects().length > 0);
      (visibleControl ?? this.document.querySelector<HTMLElement>('.ctrlem-db-button'))?.focus({ preventScroll: true });
    }
    text(this.heading, `Auto-send (${snapshot.tasks.length})`);
    text(this.status, !connected ? 'Connection lost. Last known task state; sending is not confirmed.' : error ?? '');
    flag(this.retry, 'hidden', connected && !error);
    flag(this.status.parentElement!, 'hidden', connected && !error);
    flag(this.stopAll, 'disabled', !connected || pending.has('all')); text(this.stopAll, pending.get('all') ?? 'Stop all');
    flag(this.stopAll, 'hidden', !snapshot.tasks.length);
    flag(this.collapse, 'hidden', !snapshot.tasks.length);
    for (const [id, row] of this.rows) if (!snapshot.tasks.some(task => task.id === id)) {
      const focused = row.element.contains(this.document.activeElement);
      row.element.remove(); this.rows.delete(id);
      if (focused) this.heading.focus({ preventScroll: true });
    }
    for (const task of snapshot.tasks) {
      let row = this.rows.get(task.id);
      if (!row) {
        const element = this.document.createElement('article'), title = this.document.createElement('strong');
        const source = this.document.createElement('p'), status = this.document.createElement('p');
        const stop = button(this.document, 'Stop', () => this.actions.stop(task.id));
        const resume = button(this.document, 'Resume', () => this.actions.resume(task.id));
        const open = button(this.document, 'Open page', () => this.actions.open(task.id));
        const content = this.document.createElement('div'); content.className = 'ctrlem-db-auto-task-content';
        const actions = this.document.createElement('div'); actions.className = 'ctrlem-db-auto-task-actions';
        content.append(title, source, status); actions.append(stop, resume, open);
        element.append(content, actions); this.list.append(element);
        row = { element, title, source, status, stop, resume, open }; this.rows.set(task.id, row);
      }
      text(row.title, `${task.receiver.toUpperCase()} · ${autoCommandLabel(task.command)}`);
      attribute(row.title, 'title', row.title.textContent!);
      text(row.source, task.categoryName ? `${task.categoryName} · ${task.intervalSeconds} sec` : `${task.intervalSeconds} sec`);
      attribute(row.source, 'title', row.source.textContent!);
      attribute(row.element, 'data-status', task.status);
      text(row.status, pending.get(task.id) ?? (connected ? taskStatus(task, snapshot.nextAllowedAt, Date.now()) : 'Last known: ' + task.status));
      flag(row.stop, 'disabled', !connected || pending.has(task.id) || pending.has('all') || task.status === 'stopping');
      flag(row.resume, 'hidden', task.status !== 'paused' || !snapshot.readyReceivers.includes(task.receiver));
      flag(row.open, 'hidden', task.status !== 'paused');
      flag(row.resume, 'disabled', !connected || pending.has(task.id));
      flag(row.open, 'disabled', !connected || pending.has(task.id));
    }
  }
}
