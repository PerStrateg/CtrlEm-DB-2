import type { SendCommand } from '../model/send-command';
import { emptyAutoState } from '../model/auto-send';
import type { AutoCommandKey, AutoTask } from '../model/auto-send';
import { AutoConnectionError } from '../shared/auto-send-protocol';
import type { AutoClient, AutoRequest, AutoSnapshot } from '../shared/auto-send-protocol';
import type { AutoPickerSource, PickerItemChoice } from '../shared/picker-protocol';
import { AutoSendPage } from '../site/auto-send-page';
import { CommandFields } from '../site/command-fields';
import { AutoSendControl, AutoTaskPanel } from '../ui/auto-send';

export class AutoSendController {
  private snapshot: AutoSnapshot = { ...emptyAutoState(), readyReceivers: [] };
  private connected = false;
  private disposed = false;
  private error?: string;
  private retrySeek?: Extract<AutoRequest, { type: 'auto:seek' }>;
  private readonly seeking = new Map<string, Extract<AutoRequest, { type: 'auto:seek' }>>();
  private readonly seekQueues = new Map<string, Promise<void>>();
  private receiver: string;
  private readonly controls = new Map<AutoCommandKey, AutoSendControl>();
  private readonly pending = new Map<string, string>();
  private readonly cleanups: (() => void)[] = [];
  readonly panel: AutoTaskPanel;
  constructor(private readonly page: AutoSendPage, private readonly fields: CommandFields,
    private readonly pickers: AutoPickerSource, private readonly client: AutoClient,
    private readonly captured: (command: SendCommand) => void = () => {}) {
    this.receiver = page.receiver();
    this.panel = new AutoTaskPanel(page.document, {
      dismiss: id => { void this.act({ type: 'auto:dismiss', id }); },
      stop: id => { void this.act({ type: 'auto:stop', id }, id, 'Stopping…'); },
      resume: id => { void this.act({ type: 'auto:resume', id }, id, 'Starting…'); },
      open: id => { void this.act({ type: 'auto:open', id }, id, 'Opening…'); },
      stopAll: () => { void this.act({ type: 'auto:stop-all' }, 'all', 'Stopping…'); },
      retry: () => {
        if (this.retrySeek) this.seek(this.retrySeek);
        else void this.act({ type: 'auto:snapshot' }, 'connection', 'Connecting…');
      },
    });
  }
  start(): void {
    this.page.native.mount(command => { void this.enqueue(command); },
      () => { void this.client.request({ type: 'auto:ready' }).catch(() => undefined); },
      message => { this.error = message; this.render(); });
    this.cleanups.push(this.client.subscribe(snapshot => {
      if (snapshot) this.accept(snapshot); else this.connected = false;
      this.render();
    }), this.pickers.subscribeItemChoice(choice => this.selected(choice)),
    this.fields.observe(() => this.reconcile()));
    const window = this.page.document.defaultView!;
    const detached = () => { void this.client.request({ type: 'auto:detach' }).catch(() => undefined); this.page.dispose(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) void this.act({ type: 'auto:snapshot' }); };
    window.addEventListener('pagehide', detached); window.addEventListener('pageshow', restored);
    const timer = window.setInterval(() => this.reconcile(), 1000);
    this.cleanups.push(() => { window.removeEventListener('pagehide', detached); window.removeEventListener('pageshow', restored); window.clearInterval(timer); });
    this.reconcile(); void this.act({ type: 'auto:snapshot' }, 'connection', 'Connecting…');
  }
  private async enqueue(parameters: SendCommand): Promise<void> {
    const request = { type: 'auto:enqueue' as const, id: crypto.randomUUID(), createdAt: Date.now(), parameters };
    try {
      this.accept(await this.client.request(request)); this.captured(parameters); this.error = undefined;
    } catch (error) { this.error = error instanceof Error ? error.message : 'Could not add to queue.'; }
    this.render();
  }
  private task(key: AutoCommandKey): AutoTask | undefined {
    return this.snapshot.tasks.find(task => task.receiver === this.receiver && task.command === key);
  }
  private accept(snapshot: AutoSnapshot): void {
    if (snapshot.revision >= this.snapshot.revision) this.snapshot = snapshot;
    this.connected = true;
  }
  private selected(choice: PickerItemChoice): void {
    const task = this.task(choice.command);
    if (task?.categoryId !== choice.categoryId || task.status === 'stopping') return;
    this.seek({ type: 'auto:seek', taskId: task.id, categoryId: choice.categoryId, itemId: choice.itemId });
  }
  private seek(request: Extract<AutoRequest, { type: 'auto:seek' }>): void {
    this.seeking.set(request.taskId, request); this.retrySeek = undefined; this.error = undefined; this.render();
    const operation = (this.seekQueues.get(request.taskId) ?? Promise.resolve()).then(async () => {
      if (this.disposed) return;
      try {
        const snapshot = await this.client.request(request);
        if (this.seeking.get(request.taskId) === request) this.seeking.delete(request.taskId);
        this.accept(snapshot);
      } catch (error) {
        if (this.seeking.get(request.taskId) === request) {
          this.seeking.delete(request.taskId); this.retrySeek = request;
          this.error = `Couldn’t change the next item. ${error instanceof Error ? error.message : 'Retry selection.'}`;
          if (error instanceof AutoConnectionError) this.connected = false;
        }
      } finally { this.render(); }
    });
    this.seekQueues.set(request.taskId, operation);
    void operation.then(() => { if (this.seekQueues.get(request.taskId) === operation) this.seekQueues.delete(request.taskId); });
  }
  private async act(request: AutoRequest, key?: string, pending?: string): Promise<void> {
    if (this.disposed || (key && this.pending.has(key))) return;
    if (key && pending) this.pending.set(key, pending);
    this.error = undefined; this.retrySeek = undefined; this.render();
    try { this.accept(await this.client.request(request)); }
    catch (error) {
      if (error instanceof AutoConnectionError || request.type === 'auto:snapshot' || request.type === 'auto:manual') this.connected = false;
      this.error = error instanceof Error ? error.message : 'Couldn’t update auto-send. Retry.';
    } finally { if (key) this.pending.delete(key); this.render(); }
  }
  private toggle(key: AutoCommandKey): void {
    const task = this.task(key);
    if (task?.status === 'paused' && task.reason !== 'invalid') { void this.act({ type: 'auto:resume', id: task.id }, task.id, 'Starting…'); return; }
    if (task) { void this.act({ type: 'auto:stop', id: task.id }, task.id, 'Stopping…'); return; }
    const control = this.controls.get(key)!;
    if (!control.interval.reportValidity()) return;
    const context = key === 'sendOrDelete' ? undefined : this.pickers.context(key);
    if (context?.loading || context?.loadError) { this.error = 'Wait for the library to load, then retry.'; this.render(); return; }
    void this.act({ type: 'auto:start', command: key, parameters: this.page.native.capture(key, false), categoryId: context?.selection.categoryId,
      itemId: context?.selection.itemId, intervalSeconds: control.interval.valueAsNumber }, key, 'Starting…');
  }
  private reconcile(): void {
    if (this.disposed) return;
    const receiver = this.page.receiver();
    if (receiver !== this.receiver) {
      this.receiver = receiver; this.page.dispose(); void this.act({ type: 'auto:detach' });
    }
    const state = this.page.state();
    for (const key of state.commands) {
      let control = this.controls.get(key);
      if (!control) {
        control = new AutoSendControl(this.page.document, key, { toggle: () => this.toggle(key) });
        this.controls.set(key, control);
      }
      this.page.mountControl(key, control.element);
    }
    for (const [key, control] of this.controls) if (!state.commands.includes(key)) { this.page.unmountControl(key); control.element.remove(); }
    if (!this.panel.element.isConnected) this.page.document.body.append(this.panel.element);
    this.page.placeTaskPanel(this.panel.element);
    this.render();
  }
  private render(): void {
    if (this.disposed) return;
    this.pickers.showAutoSelections(this.snapshot.tasks.flatMap(task => {
      if (task.receiver !== this.receiver || task.command === 'sendOrDelete' || !task.categoryId) return [];
      const itemId = this.seeking.get(task.id)?.itemId ?? task.highlightedItemId;
      return itemId ? [{ command: task.command, categoryId: task.categoryId, itemId }] : [];
    }));
    for (const [key, control] of this.controls) {
      const task = this.task(key);
      control.render(task, this.pending.get(task?.id ?? key) ?? this.pending.get(key) ?? this.pending.get('all'), this.connected);
    }
    this.panel.render(this.snapshot, this.connected, this.pending, this.error);
    this.page.placeTaskPanel(this.panel.element);
  }
  dispose(): void {
    void this.client.request({ type: 'auto:detach' }).catch(() => undefined);
    this.disposed = true; for (const cleanup of this.cleanups) cleanup(); this.page.dispose(); this.page.restoreLayout();
    for (const control of this.controls.values()) control.element.remove(); this.panel.element.remove();
  }
}
