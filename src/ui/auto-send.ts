import { autoCommandLabel, autoSendLimits, pauseReasons, orderedQueue, projectedSendTimes, isManualSend, sendFailureMessages } from '../model/auto-send';
import { sendQueueLimits } from '../model/send-command';
import type { AutoCommandKey, AutoTask } from '../model/auto-send';
import { receiverLabel } from '../model/send-command';
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
function taskDetails(task: Pick<AutoTask, 'status' | 'reason' | 'failureCode' | 'retryCount'>): string {
  const cause = task.failureCode ? `${sendFailureMessages[task.failureCode]} ` : '';
  if (task.status === 'paused') return `Paused · ${cause}${task.reason === 'failed' && (task.retryCount ?? 0) > sendQueueLimits.maxRetries
    ? 'Retry limit reached. Resume to try again.' : pauseReasons[task.reason!]}`;
  if (task.status === 'stopping') return 'Stopping…';
  if (task.status === 'running') return 'Waiting for the site…';
  if (task.reason === 'busy') return 'Waiting to send…';
  if (task.reason === 'failed') return `${cause}Retry ${task.retryCount}/${sendQueueLimits.maxRetries}`;
  return '';
}
function countdown(at: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((at - now) / 1000));
  return `In ~${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
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
    const action = pending ?? (task?.status === 'paused' && task.reason !== 'invalid' ? 'Resume auto-send' : task ? 'Stop auto-send' : 'Start auto-send');
    attribute(this.toggle, 'title', action); attribute(this.toggle, 'aria-label', action);
    attribute(this.toggle, 'aria-pressed', String(Boolean(task && task.status !== 'paused')));
    attribute(this.toggle, 'aria-busy', String(Boolean(pending || task?.status === 'stopping')));
    flag(this.toggle, 'disabled', Boolean(pending) || task?.status === 'stopping' || !connected);
    flag(this.interval, 'disabled', Boolean(task || pending));
    if (task && this.interval.value !== String(task.intervalSeconds)) this.interval.value = String(task.intervalSeconds);
  }
}
interface TaskRow { element: HTMLElement; title: HTMLElement; source: HTMLElement; status: HTMLElement; details: HTMLElement; info: HTMLButtonElement; stop: HTMLButtonElement; resume: HTMLButtonElement; open: HTMLButtonElement }
export class AutoTaskPanel {
  readonly element: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly collapse: HTMLButtonElement;
  private readonly stopAll: HTMLButtonElement;
  private readonly retry: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly list: HTMLElement;
  private readonly notices = new Map<string, HTMLElement>();
  private readonly rows = new Map<string, TaskRow>();
  private collapsed = false;
  constructor(private readonly document: Document, private readonly actions: {
    dismiss?(id: string): void; stop(id: string): void; resume(id: string): void; open(id: string): void; stopAll(): void; retry(): void;
  }) {
    this.element = document.createElement('section'); this.element.className = 'ctrlem-db-auto-panel ctrlem-db-ui';
    this.element.setAttribute('aria-label', 'Send queue');
    const header = document.createElement('header');
    this.heading = document.createElement('strong'); this.heading.tabIndex = -1;
    this.list = document.createElement('div'); this.list.className = 'ctrlem-db-auto-tasks';
    this.collapse = button(document, '', () => {
      this.collapsed = !this.collapsed; this.list.hidden = this.collapsed;
      this.collapse.setAttribute('aria-expanded', String(!this.collapsed));
      this.collapse.title = this.collapsed ? 'Expand queue' : 'Collapse queue';
      this.collapse.setAttribute('aria-label', this.collapse.title);
    });
    this.collapse.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    this.collapse.className = 'ctrlem-db-auto-collapse'; this.collapse.title = 'Collapse queue';
    this.collapse.setAttribute('aria-label', 'Collapse queue');
    this.collapse.setAttribute('aria-expanded', 'true');
    this.stopAll = button(document, 'Stop all', actions.stopAll);
    this.retry = button(document, 'Retry', actions.retry);
    this.status = document.createElement('p'); this.status.setAttribute('role', 'status');
    const notice = document.createElement('div'); notice.className = 'ctrlem-db-auto-notice'; notice.append(this.status, this.retry);
    header.append(this.heading, this.collapse, this.stopAll); this.element.append(header, notice, this.list);
  }
  render(snapshot: AutoSnapshot, connected: boolean, pending: ReadonlyMap<string, string>, error?: string): void {
    const now = Date.now(), times = projectedSendTimes(snapshot, now);
    const entries = orderedQueue(snapshot, now).map(entry => isManualSend(entry)
      ? { ...entry, manual: true, label: entry.parameters.label, source: `Manual · ${entry.parameters.fields.find(field => field.value)?.value ?? ''}` }
      : { ...entry, manual: false, label: autoCommandLabel(entry.command), source: `${entry.categoryName} · Auto · ${entry.intervalSeconds} sec` });
    const panelHadFocus = this.element.contains(this.document.activeElement);
    flag(this.element, 'hidden', !entries.length && !snapshot.notices.length && !error);
    if (this.element.hidden && panelHadFocus) {
      const visibleControl = Array.from(this.document.querySelectorAll<HTMLButtonElement>('.ctrlem-db-auto-control button'))
        .find(button => !button.disabled && button.getClientRects().length > 0);
      (visibleControl ?? this.document.querySelector<HTMLElement>('.ctrlem-db-button'))?.focus({ preventScroll: true });
    }
    text(this.heading, `Send queue (${entries.length})`);
    text(this.status, connected ? error ?? '' : '');
    text(this.retry, connected ? 'Retry' : 'Refresh');
    flag(this.retry, 'hidden', connected && !error);
    flag(this.status.parentElement!, 'hidden', connected && !error);
    flag(this.stopAll, 'disabled', !connected || pending.has('all')); text(this.stopAll, pending.get('all') ?? 'Stop all');
    flag(this.stopAll, 'hidden', !entries.length);
    flag(this.collapse, 'hidden', !entries.length);
    for (const [id, row] of this.rows) if (!entries.some(task => task.id === id)) {
      const focused = row.element.contains(this.document.activeElement);
      row.element.remove(); this.rows.delete(id);
      if (focused) this.heading.focus({ preventScroll: true });
    }
    for (const task of entries) {
      let row = this.rows.get(task.id);
      if (!row) {
        const element = this.document.createElement('article'), title = this.document.createElement('strong');
        const source = this.document.createElement('span'), status = this.document.createElement('span');
        const details = this.document.createElement('div'); details.className = 'ctrlem-db-task-details';
        details.id = `ctrlem-db-task-details-${task.id}`; details.setAttribute('popover', 'auto');
        const info = button(this.document, 'i', () => {});
        info.className = 'ctrlem-db-task-info'; info.setAttribute('popovertarget', details.id);
        info.setAttribute('aria-label', `Details for ${task.label} to ${receiverLabel(task.receiver)}`);
        const stop = button(this.document, 'Stop', () => this.actions.stop(task.id));
        const resume = button(this.document, 'Resume', () => this.actions.resume(task.id));
        const open = button(this.document, 'Open page', () => this.actions.open(task.id));
        title.className = 'ctrlem-db-task-receiver'; source.className = 'ctrlem-db-task-command'; status.className = 'ctrlem-db-task-status';
        const actions = this.document.createElement('div'); actions.className = 'ctrlem-db-auto-task-actions';
        actions.append(info, stop, resume, open);
        element.append(title, source, status, actions, details); this.list.append(element);
        row = { element, title, source, status, details, info, stop, resume, open }; this.rows.set(task.id, row);
      }
      text(row.title, receiverLabel(task.receiver));
      attribute(row.title, 'title', row.title.textContent!);
      text(row.source, task.label);
      attribute(row.source, 'title', task.source);
      const details = [task.source, taskDetails(task)].filter(Boolean).join(' · ');
      text(row.details, details);
      attribute(row.element, 'data-status', task.status);
      text(row.status, pending.get(task.id) ?? (!connected ? '—' : task.status === 'paused' ? 'Paused' :
        task.status === 'stopping' ? 'Stopping…' : task.status === 'running' ? 'Sending…' :
          task.reason === 'busy' ? 'Site busy' : times.has(task.id) ? countdown(times.get(task.id)!, now) : 'Awaiting site…'));
      attribute(row.status, 'title', connected ? taskDetails(task) || 'Time until next send' : 'Refresh to update');
      text(row.stop, task.manual ? 'Cancel' : 'Stop');
      flag(row.stop, 'disabled', !connected || pending.has(task.id) || pending.has('all') || task.status === 'stopping');
      flag(row.resume, 'hidden', task.status !== 'paused' || task.reason === 'invalid' || !snapshot.readyReceivers.includes(task.receiver));
      flag(row.open, 'hidden', task.status !== 'paused' || snapshot.readyReceivers.includes(task.receiver));
      flag(row.resume, 'disabled', !connected || pending.has(task.id));
      flag(row.open, 'disabled', !connected || pending.has(task.id));
      const position = entries.indexOf(task);
      if (this.list.children[position] !== row.element) this.list.insertBefore(row.element, this.list.children[position] ?? null);
    }
    for (const [id, notice] of this.notices) if (!snapshot.notices.some(item => item.id === id)) { notice.remove(); this.notices.delete(id); }
    for (const item of snapshot.notices) if (!this.notices.has(item.id)) {
      const notice = this.document.createElement('p'); notice.className = 'ctrlem-db-queue-result';
      notice.append(`${receiverLabel(item.receiver)} · ${item.label}: ${item.message} `,
        button(this.document, 'Dismiss', () => this.actions.dismiss?.(item.id)));
      this.notices.set(item.id, notice); this.element.append(notice);
    }
  }
}
