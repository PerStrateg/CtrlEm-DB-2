import { commands } from '../model/commands';
import { autoSendLimits, emptyAutoState, nextAutoItem } from '../model/auto-send';
import type { AutoExecution, AutoOutcome, AutoState, AutoTask, PauseReason } from '../model/auto-send';
import type { Item } from '../model/library';
import { AutoSendRepository } from '../storage/auto-send-store';
import { LibraryRepository, WriteQueue } from '../storage/library-store';
import type { AutoPageState, AutoRequest, AutoSnapshot } from '../shared/auto-send-protocol';

export interface AutoTransport {
  probe(tabId: number): Promise<AutoPageState | undefined>;
  pages(): Promise<{ tabId: number; page: AutoPageState }[]>;
  execute(tabId: number, execution: AutoExecution): Promise<AutoOutcome>;
  open(receiver: string): Promise<void>;
  changed(snapshot: AutoSnapshot | undefined): void;
  wakeAt(time: number | undefined): void;
}
export class AutoSendError extends Error {}

/** One serialized owner. Persist the execution token before any native side effect. */
export class AutoSendService {
  private readonly queue = new WriteQueue();
  private state: AutoState = emptyAutoState();
  private loaded = false;
  private fault = false;
  private preparing = false;
  private readyReceivers: string[] = [];
  constructor(private readonly repository: AutoSendRepository, private readonly library: LibraryRepository,
    private readonly transport: AutoTransport, private readonly now = Date.now) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.state = await this.repository.read();
    const state = structuredClone(this.state);
    for (const task of state.tasks) if (task.execution) {
      // A sleeping worker may have missed the reply. Never replay its token.
      this.pause(task, 'unknown');
      state.nextAllowedAt = Math.max(state.nextAllowedAt, this.now() + autoSendLimits.minSeconds * 1000);
    }
    if (state.tasks.length) this.readyReceivers = [...new Set((await this.transport.pages()).map(({ page }) => page.receiver))];
    await this.commit(state);
    this.loaded = true;
  }
  private pause(task: AutoTask, reason: PauseReason): void {
    task.status = 'paused'; task.reason = reason; delete task.execution;
  }
  private async commit(state: AutoState): Promise<void> {
    state.revision = this.state.revision + 1;
    try { await this.repository.save(state); }
    catch {
      this.fault = true; this.transport.wakeAt(undefined); this.transport.changed(undefined);
      throw new AutoSendError('Couldn’t save task state. Retry the connection.');
    }
    this.state = state; this.fault = false;
    this.transport.changed(this.snapshot()); this.schedule();
  }
  private snapshot(): AutoSnapshot { return { ...structuredClone(this.state), readyReceivers: [...this.readyReceivers] }; }
  private schedule(): void {
    const running = this.state.tasks.find(task => task.execution);
    const times = this.state.tasks.filter(task => task.status === 'queued').map(task => Math.max(task.dueAt, this.state.nextAllowedAt));
    this.transport.wakeAt(this.fault ? undefined : running?.execution?.deadline ?? (times.length ? Math.min(...times) : undefined));
  }
  private async items(task: AutoTask, page: AutoPageState): Promise<Item[]> {
    if (task.command === 'sendOrDelete') return [];
    if (task.categoryId === 'default') return page.galleries[task.command] ?? [];
    const type = commands[task.command].type;
    const category = (await this.library.read()).categories.find(category => category.id === task.categoryId && category.type === type);
    if (category) task.categoryName = category.name;
    return category?.items ?? [];
  }
  handle(tabId: number, receiver: string, request: AutoRequest): Promise<AutoSnapshot> {
    return this.queue.run(async () => {
      await this.load();
      if (this.fault) {
        const recovered = structuredClone(this.state);
        for (const task of recovered.tasks) this.pause(task, 'storage');
        recovered.nextAllowedAt = this.now() + autoSendLimits.minSeconds * 1000;
        await this.commit(recovered);
      }
      const state = structuredClone(this.state);
      switch (request.type) {
        case 'auto:snapshot': {
          this.readyReceivers = [...new Set((await this.transport.pages()).map(({ page }) => page.receiver))];
          this.transport.changed(this.snapshot());
          this.schedule(); return this.snapshot();
        }
        case 'auto:start': {
          if (state.tasks.some(task => task.receiver === receiver && task.command === request.command)) return this.snapshot();
          const page = await this.transport.probe(tabId);
          if (!page || page.receiver !== receiver || !page.commands.includes(request.command)) throw new AutoSendError('Open the command on the recipient’s page.');
          const task: AutoTask = { id: crypto.randomUUID(), receiver, command: request.command, tabId,
            categoryId: request.categoryId, categoryName: request.categoryId === 'default' ? 'Default' : '',
            intervalSeconds: request.intervalSeconds, status: 'queued', dueAt: this.now(), orderIds: [], nextItemId: request.itemId, selectionRevision: 0 };
          const items = await this.items(task, page);
          if (task.command !== 'sendOrDelete' && !items.length) throw new AutoSendError('Choose a non-empty category.');
          task.orderIds = items.map(item => item.id);
          task.nextItemId = nextAutoItem(task, items)?.id;
          task.highlightedItemId = task.nextItemId;
          state.tasks.push(task); break;
        }
        case 'auto:seek': {
          const task = state.tasks.find(task => task.id === request.taskId);
          if (!task || task.receiver !== receiver || task.categoryId !== request.categoryId || task.command === 'sendOrDelete' || task.status === 'stopping') {
            throw new AutoSendError('This selection does not belong to an available task.');
          }
          const page = await this.transport.probe(tabId);
          if (!page || page.receiver !== receiver) throw new AutoSendError('Open the recipient’s page to change the selection.');
          const items = await this.items(task, page);
          if (!items.some(item => item.id === request.itemId)) throw new AutoSendError('The selected item is no longer available. Choose another item.');
          task.nextItemId = task.highlightedItemId = request.itemId;
          task.orderIds = items.map(item => item.id); task.selectionRevision++;
          break;
        }
        case 'auto:stop':
        case 'auto:stop-all': {
          state.tasks = state.tasks.filter(task => {
            if (request.type === 'auto:stop' && task.id !== request.id) return true;
            if (!task.execution) return false;
            task.status = 'stopping'; return true;
          }); break;
        }
        case 'auto:resume': {
          const task = state.tasks.find(task => task.id === request.id);
          if (!task || task.status !== 'paused') return this.snapshot();
          const pages = await this.transport.pages();
          const candidates = pages.filter(({ page }) => page.receiver === task.receiver && page.commands.includes(task.command));
          const candidate = candidates.find(page => page.tabId === tabId) ?? candidates.find(page => page.tabId === task.tabId) ?? candidates[0];
          if (!candidate) throw new AutoSendError('Open the recipient’s page before resuming.');
          const items = await this.items(task, candidate.page);
          if (task.command !== 'sendOrDelete' && !items.length) throw new AutoSendError('Choose a non-empty category. Stop this task to change its source.');
          task.tabId = candidate.tabId; task.status = 'queued'; delete task.reason; task.dueAt = this.now(); break;
        }
        case 'auto:open': {
          const task = state.tasks.find(task => task.id === request.id);
          if (task) await this.transport.open(task.receiver);
          return this.snapshot();
        }
        case 'auto:manual': state.nextAllowedAt = Math.max(state.nextAllowedAt, this.now() + autoSendLimits.minSeconds * 1000); break;
        case 'auto:detach': this.detach(state, tabId); break;
      }
      await this.commit(state); return this.snapshot();
    });
  }
  private detach(state: AutoState, tabId: number): void {
    state.tasks = state.tasks.filter(task => task.tabId !== tabId || task.status !== 'stopping');
    for (const task of state.tasks) if (task.tabId === tabId) {
      this.pause(task, 'interrupted');
      state.nextAllowedAt = Math.max(state.nextAllowedAt, this.now() + autoSendLimits.minSeconds * 1000);
    }
  }
  removeTab(tabId: number): Promise<void> {
    return this.queue.run(async () => {
      await this.load();
      if (!this.state.tasks.some(task => task.tabId === tabId)) return;
      const state = structuredClone(this.state); this.detach(state, tabId);
      await this.commit(state);
    });
  }
  async tick(): Promise<void> {
    const candidate = await this.queue.run(async () => {
      await this.load();
      if (this.fault || this.preparing) return;
      const state = structuredClone(this.state), now = this.now();
      const running = state.tasks.find(task => task.execution);
      if (running) {
        if (running.execution!.deadline <= now) await this.finish(running.execution!.token, { status: 'paused', reason: 'unknown' });
        else this.schedule();
        return;
      }
      const task = state.tasks.filter(task => task.status === 'queued')
        .sort((a, b) => a.dueAt - b.dueAt)[0];
      if (!task || Math.max(task.dueAt, state.nextAllowedAt) > now) { this.schedule(); return; }
      this.preparing = true;
      return task;
    });
    if (!candidate) return;
    // Keep Stop and manual Send responsive while asking a potentially slow tab.
    let items: Item[] = [], reason: PauseReason | undefined;
    try {
      const page = await this.transport.probe(candidate.tabId);
      if (!page || page.receiver !== candidate.receiver || !page.commands.includes(candidate.command)) reason = 'unavailable';
      else items = await this.items(candidate, page);
    } catch { reason = 'storage'; }
    await this.queue.run(async () => {
      this.preparing = false;
      if (this.fault) return;
      const state = structuredClone(this.state), task = state.tasks.find(task => task.id === candidate.id);
      if (!task || task.status !== 'queued' || task.tabId !== candidate.tabId ||
        Math.max(task.dueAt, state.nextAllowedAt) > this.now()) { this.schedule(); return; }
      // A choice made during preparation needs a fresh view of its source.
      if (task.selectionRevision !== candidate.selectionRevision) { this.schedule(); return; }
      if (reason) { this.pause(task, reason); await this.commit(state); return; }
      task.categoryName = candidate.categoryName;
      const item = nextAutoItem(task, items);
      if (task.command !== 'sendOrDelete' && !item) {
        this.pause(task, 'empty'); await this.commit(state); return;
      }
      task.orderIds = items.map(item => item.id); task.nextItemId = item?.id;
      task.highlightedItemId = item?.id;
      task.status = 'running';
      task.execution = { token: crypto.randomUUID(), receiver: task.receiver, command: task.command,
        value: item?.value, itemId: item?.id, selectionRevision: task.selectionRevision,
        deadline: this.now() + autoSendLimits.resultTimeoutMs };
      await this.commit(state);
      // Do not occupy the mutation queue while the site answers: Stop must still work.
      const token = task.execution.token;
      void this.transport.execute(task.tabId, task.execution).then(
        outcome => this.result(token, outcome),
        () => this.result(token, { status: 'paused', reason: 'unknown' }),
      ).catch(() => { /* commit already published the storage failure and stopped the clock */ });
    });
  }
  private result(token: string, outcome: AutoOutcome): Promise<void> {
    return this.queue.run(() => this.finish(token, outcome));
  }
  private async finish(token: string, outcome: AutoOutcome): Promise<void> {
    const state = structuredClone(this.state), task = state.tasks.find(task => task.execution?.token === token);
    if (!task) return;
    state.nextAllowedAt = Math.max(state.nextAllowedAt, this.now() + autoSendLimits.minSeconds * 1000);
    if (task.status === 'stopping') state.tasks = state.tasks.filter(candidate => candidate !== task);
    else if (outcome.status === 'success') {
      if (task.selectionRevision === task.execution!.selectionRevision) {
        const index = task.orderIds.indexOf(task.execution!.itemId ?? '');
        task.nextItemId = task.orderIds[(index + 1) % task.orderIds.length];
      }
      task.status = 'queued'; task.dueAt = this.now() + task.intervalSeconds * 1000; delete task.execution;
    } else this.pause(task, outcome.reason);
    if (this.fault) for (const candidate of state.tasks) this.pause(candidate, 'storage');
    await this.commit(state);
  }
}
