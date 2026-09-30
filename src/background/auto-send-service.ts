import { sendQueueLimits } from '../model/send-command';
import { commands } from '../model/commands';
import { autoSendLimits, emptyAutoState, nextAutoItem, isManualSend as manual, orderedQueue, queueAvailableAt } from '../model/auto-send';
import type { AutoExecution, AutoOutcome, AutoState, AutoTask, QueueEntry, PauseReason } from '../model/auto-send';
import { AutoSendRepository } from '../storage/auto-send-store';
import { LibraryRepository, WriteQueue } from '../storage/library-store';
import type { AutoPageState, AutoRequest, AutoSnapshot } from '../shared/auto-send-protocol';
import type { FilesSource } from './files-service';

export interface AutoTransport {
  probe(tabId: number): Promise<AutoPageState | undefined>;
  pages(): Promise<{ tabId: number; page: AutoPageState }[]>;
  execute(execution: AutoExecution): Promise<AutoOutcome>;
  open(receiver: string): Promise<void>;
  changed(snapshot: AutoSnapshot | undefined): void;
  wakeAt(time: number | undefined): void;
}
export interface DefaultImageSource { items(): Promise<{ id: string; value: string; label?: string }[]> }
export class AutoSendError extends Error {}

/** One serialized owner. Persist the execution token before any native side effect. */
export class AutoSendService {
  private state: AutoState = emptyAutoState();
  private loaded = false;
  private fault = false;
  private readonly preparing = new Set<string>();
  private readonly filePreparations = new Map<string, { token: string; abort: AbortController }>();
  private fileUpload?: { id: string; itemId: string; abort: AbortController };
  private readyReceivers: string[] = [];
  private readonly manualOutcomes = new Map<string, 'success' | 'failed'>();
  private readonly manualWaiters = new Set<() => void>();
  constructor(private readonly repository: AutoSendRepository, private readonly library: LibraryRepository,
    private readonly transport: AutoTransport, private readonly now = Date.now,
    private readonly queue = new WriteQueue(), private readonly files?: FilesSource,
    private readonly defaultImages?: DefaultImageSource) {}

  /** Called under the shared library/dispatch queue; never enqueue recursively. */
  async libraryChanged(): Promise<void> {
    try {
      await this.load();
      const state = structuredClone(this.state);
      if (await this.reconcileSources(state)) await this.commit(state);
    } catch (error) {
      this.fault = true; this.transport.wakeAt(undefined); this.transport.changed(undefined);
      throw error;
    }
  }
  private async reconcileSources(state: AutoState): Promise<boolean> {
    const tasks = state.tasks.filter(task => task.source !== 'files' && task.command !== 'sendOrDelete' && task.categoryId !== 'default');
    if (!tasks.length) return false;
    const library = await this.library.read();
    let changed = false;
    for (const task of tasks) {
      const category = library.categories.find(category => category.id === task.categoryId);
      if (!category) {
        if (task.execution) {
          if (task.status !== 'stopping') { task.status = 'stopping'; changed = true; }
        } else { state.tasks = state.tasks.filter(entry => entry !== task); changed = true; }
        continue;
      }
      if (task.execution && !task.execution.sourceInvalidated && !category.items.some(item => item.id === task.execution!.itemId)) {
        task.execution.sourceInvalidated = true; changed = true;
      }
      if (task.retryExecution && !category.items.some(item => item.id === task.retryExecution!.itemId)) {
        delete task.retryExecution; task.retryCount = 0; delete task.failureCode;
        task.nextItemId = task.highlightedItemId = nextAutoItem(task, category.items)?.id;
        task.orderIds = category.items.map(item => item.id);
        if (!category.items.length) this.pause(task, 'empty');
        else if (task.reason === 'failed') { task.status = 'queued'; delete task.reason; }
        changed = true;
      }
    }
    return changed;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.state = await this.repository.read();
    const state = structuredClone(this.state);
    for (const entry of this.entries(state)) if (entry.preparation) {
      delete entry.preparation; entry.status = 'paused'; entry.reason = 'interrupted';
    }
    for (const task of state.tasks) if (task.execution) {
      // A sleeping worker may have missed the reply. Never replay its token.
      this.notice(state, task);
      this.cooldown(state, task, this.now());
      if (task.status === 'stopping') state.tasks = state.tasks.filter(entry => entry !== task);
      else this.advance(task, this.now());
    }
    for (const send of state.sends.filter(send => send.execution)) {
      this.notice(state, send); this.cooldown(state, send, this.now());
      state.sends = state.sends.filter(item => item !== send);
    }
    if (state.tasks.length || state.sends.length) this.readyReceivers = [...new Set((await this.transport.pages()).map(({ page }) => page.receiver))];
    await this.reconcileSources(state);
    await this.commit(state);
    this.loaded = true;
  }
  private pause(task: QueueEntry, reason: PauseReason): void {
    task.status = 'paused'; task.reason = reason; delete task.execution;
  }
  private async commit(state: AutoState): Promise<void> {
    state.acceptedRequests = state.acceptedRequests.filter(request => request.expiresAt > this.now());
    state.revision = this.state.revision + 1;
    try { await this.repository.save(state); }
    catch {
      this.fault = true; this.transport.wakeAt(undefined); this.transport.changed(undefined);
      for (const waiter of this.manualWaiters) waiter();
      throw new AutoSendError('Couldn’t save task state. Retry the connection.');
    }
    this.state = state; this.fault = false;
    for (const [id, work] of this.filePreparations) if (!this.entries(state).some(entry => entry.id === id && entry.preparation?.token === work.token)) {
      work.abort.abort(); this.filePreparations.delete(id);
    }
    if (this.fileUpload && !this.entries(state).some(entry => entry.id === this.fileUpload!.id && entry.status === 'queued' && entry.preparedItemId === this.fileUpload!.itemId)) this.fileUpload.abort.abort();
    this.transport.changed(this.snapshot()); this.schedule();
    for (const waiter of this.manualWaiters) waiter();
  }
  private snapshot(): AutoSnapshot {
    const { acceptedRequests, ...visible } = this.state;
    return { ...structuredClone(visible), readyReceivers: [...this.readyReceivers] };
  }
  private entries(state = this.state): QueueEntry[] { return [...state.sends, ...state.tasks]; }
  private availableAt(entry: QueueEntry, state = this.state): number { return queueAvailableAt(entry, state); }
  private ordered(state = this.state): QueueEntry[] {
    const uploading = this.entries(state).some(entry => entry.source === 'files' && this.preparing.has(entry.id));
    return orderedQueue(state, this.now()).filter(entry => entry.status === 'queued' && !entry.preparation &&
      !this.preparing.has(entry.id) && !(uploading && entry.source === 'files'));
  }
  private acceptManual(state: AutoState, receiver: string, request: Extract<AutoRequest, { type: 'auto:enqueue' }>, tabId?: number): void {
    if (state.sends.some(send => send.id === request.id) || state.acceptedRequests.some(entry => entry.id === request.id && entry.expiresAt > this.now())) return;
    const expiresAt = request.createdAt + sendQueueLimits.requestWindowMs;
    if (expiresAt <= this.now() || request.createdAt > this.now()) throw new AutoSendError('Send request expired. Click Send again if needed.');
    state.sends.push({ id: request.id, receiver, tabId: request.source === 'files' ? tabId : undefined, parameters: request.parameters, status: 'queued',
      dueAt: this.now(), sequence: ++state.sequence, retryCount: 0, source: request.source, fileId: request.fileId });
    state.acceptedRequests.push({ id: request.id, expiresAt });
  }
  private schedule(): void {
    const running = this.entries().find(task => task.execution);
    const times = this.ordered().map(task => this.availableAt(task));
    const executionWake = running?.execution?.deadline;
    const workTimes = executionWake === undefined ? times : [executionWake];
    const deadlines = [...workTimes, ...this.state.acceptedRequests.map(request => request.expiresAt)];
    this.transport.wakeAt(this.fault || !deadlines.length ? undefined : Math.min(...deadlines));
  }
  private notice(state: AutoState, entry: QueueEntry): void {
    state.notices.push({ id: crypto.randomUUID(), receiver: entry.receiver,
      label: manual(entry) ? entry.parameters.label : entry.command, message: 'Unconfirmed. Not repeated.' });
    if (state.notices.length > autoSendLimits.maxNotices) state.notices.shift();
  }
  private cooldown(state: AutoState, entry: QueueEntry, now: number): void {
    state.nextAllowedAt = Math.max(state.nextAllowedAt, now + sendQueueLimits.userMs);
    if (entry.receiver.startsWith('group:')) state.groupAllowedAt = Math.max(state.groupAllowedAt, now + sendQueueLimits.groupMs);
  }
  private advance(task: AutoTask, now: number): void {
    if (task.execution && task.selectionRevision === task.execution.selectionRevision) {
      const index = task.orderIds.indexOf(task.execution.itemId ?? '');
      task.nextItemId = task.orderIds[(index + 1) % task.orderIds.length];
    }
    task.status = 'queued'; task.dueAt = now + task.intervalSeconds * 1000;
    task.retryCount = 0; delete task.execution; delete task.retryExecution; delete task.reason; delete task.failureCode;
    delete task.preparedItemId;
  }
  private async items(task: AutoTask, defaultItems: { id: string; value: string }[] = []): Promise<{ id: string; value?: string }[]> {
    if (task.source === 'files') return this.files!.items();
    if (task.command === 'sendOrDelete') return [];
    if (task.categoryId === 'default') return defaultItems;
    const type = commands[task.command].type;
    const category = (await this.library.read()).categories.find(category => category.id === task.categoryId && category.type === type);
    if (category) task.categoryName = category.name;
    return category?.items ?? [];
  }
  async handle(tabId: number, receiver: string, request: AutoRequest): Promise<AutoSnapshot> {
    await this.queue.run(() => this.load());
    const needsDefault = ((request.type === 'auto:start' || request.type === 'auto:seek') && request.categoryId === 'default') ||
      (request.type === 'auto:resume' && this.state.tasks.some(task => task.id === request.id && task.categoryId === 'default'));
    const defaultItems = needsDefault ? await this.defaultImages?.items() ?? [] : [];
    return this.queue.run(async () => {
      await this.load();
      if (this.fault) {
        const recovered = structuredClone(this.state);
        for (const task of this.entries(recovered)) this.pause(task, 'storage');
        recovered.nextAllowedAt = this.now() + autoSendLimits.minSeconds * 1000;
        await this.commit(recovered);
      }
      await this.libraryChanged();
      const state = structuredClone(this.state);
      switch (request.type) {
        case 'auto:dismiss': state.notices = state.notices.filter(notice => notice.id !== request.id); break;
        case 'auto:enqueue': {
          if (request.source === 'files' && (request.parameters.key !== 'popupImage' || !request.fileId || !(await this.files!.items()).some(item => item.id === request.fileId))) throw new AutoSendError('Choose an available file.');
          const page = await this.transport.probe(tabId);
          if (!page || page.receiver !== receiver || !page.commands.some(command => command === request.parameters.key)) throw new AutoSendError('Command is unavailable on this page.');
          this.acceptManual(state, receiver, request, tabId); break;
        }
        case 'auto:snapshot': {
          this.readyReceivers = [...new Set((await this.transport.pages()).map(({ page }) => page.receiver))];
          this.transport.changed(this.snapshot());
          this.schedule(); return this.snapshot();
        }
        case 'auto:start': {
          if (request.parameters && request.parameters.key !== request.command) throw new AutoSendError('Command parameters do not match.');
          if (request.source === 'files' && request.command !== 'popupImage') throw new AutoSendError('Local Upload supports Popup Image.');
          if (state.tasks.some(task => task.receiver === receiver && task.command === request.command && task.source === request.source)) return this.snapshot();
          const page = await this.transport.probe(tabId);
          if (!page || page.receiver !== receiver || !page.commands.includes(request.command)) throw new AutoSendError('Open the command on the recipient’s page.');
          const task: AutoTask = { id: crypto.randomUUID(), receiver, command: request.command, tabId: request.source === 'files' ? tabId : undefined,
            source: request.source, parameters: request.parameters, categoryId: request.categoryId, categoryName: request.source === 'files' ? 'Local Upload' : request.categoryId === 'default' ? 'Default' : '',
            intervalSeconds: request.intervalSeconds, status: 'queued', dueAt: this.now(), orderIds: [], nextItemId: request.itemId, selectionRevision: 0 };
          const items = await this.items(task, defaultItems);
          if (task.command !== 'sendOrDelete' && !items.length) throw new AutoSendError('Choose a non-empty category.');
          task.orderIds = items.map(item => item.id);
          task.nextItemId = nextAutoItem(task, items)?.id;
          task.highlightedItemId = task.nextItemId;
          state.tasks.push(task); break;
        }
        case 'auto:seek': {
          const task = state.tasks.find(task => task.id === request.taskId);
          if (!task || task.receiver !== receiver || task.source !== request.source || task.categoryId !== request.categoryId || task.command === 'sendOrDelete' || task.status === 'stopping') {
            throw new AutoSendError('This selection does not belong to an available task.');
          }
          const items = await this.items(task, defaultItems);
          if (!items.some(item => item.id === request.itemId)) throw new AutoSendError('The selected item is no longer available. Choose another item.');
          task.nextItemId = task.highlightedItemId = request.itemId;
          task.orderIds = items.map(item => item.id); task.selectionRevision++; delete task.retryExecution;
          delete task.preparation; delete task.preparedItemId;
          break;
        }
        case 'auto:stop':
        case 'auto:stop-all': {
          state.sends = state.sends.filter(send => {
            if (request.type === 'auto:stop' && send.id !== request.id) return true;
            if (!send.execution) return false;
            send.status = 'stopping'; return true;
          });
          state.tasks = state.tasks.filter(task => {
            if (request.type === 'auto:stop' && task.id !== request.id) return true;
            if (!task.execution) return false;
            task.status = 'stopping'; return true;
          }); break;
        }
        case 'auto:resume': {
          const task = this.entries(state).find(task => task.id === request.id);
          if (!task || task.status !== 'paused') return this.snapshot();
          if (task.reason === 'invalid') throw new AutoSendError('Cancel or stop this task, correct the command, then send again.');
          const items = manual(task) || task.retryExecution ? [] : await this.items(task, defaultItems);
          if (!manual(task) && !task.retryExecution && task.command !== 'sendOrDelete' && !items.length) throw new AutoSendError('Choose a non-empty category. Stop this task to change its source.');
          task.status = 'queued'; task.retryCount = 0; delete task.reason; delete task.failureCode; delete task.fileError; task.dueAt = this.now(); break;
        }
        case 'auto:open': {
          const task = this.entries(state).find(task => task.id === request.id);
          if (task) await this.transport.open(task.receiver);
          return this.snapshot();
        }
        case 'auto:manual': state.nextAllowedAt = Math.max(state.nextAllowedAt, this.now() + autoSendLimits.minSeconds * 1000); break;
      }
      await this.commit(state); return this.snapshot();
    });
  }
  async enqueueBatch(requests: { receiver: string; request: Extract<AutoRequest, { type: 'auto:enqueue' }> }[]): Promise<{ sent: number; failed: number }> {
    const { completion } = await this.queue.run(async () => {
      await this.load();
      if (this.fault) throw new AutoSendError('Couldn’t save task state. Retry the connection.');
      const state = structuredClone(this.state);
      for (const { receiver, request } of requests) this.acceptManual(state, receiver, request);
      await this.commit(state);
      return { completion: this.waitManual(requests.map(({ request }) => request.id)) };
    });
    return completion;
  }
  enqueue(receiver: string, request: Extract<AutoRequest, { type: 'auto:enqueue' }>): Promise<AutoSnapshot> {
    return this.queue.run(async () => {
      await this.load();
      if (this.fault) throw new AutoSendError('Couldn’t save task state. Retry the connection.');
      const state = structuredClone(this.state);
      this.acceptManual(state, receiver, request);
      await this.commit(state);
      return this.snapshot();
    });
  }
  private waitManual(ids: string[]): Promise<{ sent: number; failed: number }> {
    for (const id of ids) this.manualOutcomes.set(id, 'failed');
    return new Promise(resolve => {
      const inspect = () => {
        const sends = new Map(this.state.sends.map(send => [send.id, send]));
        const outcomes = ids.map(id => {
          const send = sends.get(id);
          return this.fault ? 'failed' : send && send.status !== 'paused' ? undefined : this.manualOutcomes.get(id);
        });
        if (outcomes.some(outcome => outcome === undefined)) return;
        this.manualWaiters.delete(inspect); for (const id of ids) this.manualOutcomes.delete(id);
        resolve({ sent: outcomes.filter(outcome => outcome === 'success').length, failed: outcomes.filter(outcome => outcome === 'failed').length });
      };
      this.manualWaiters.add(inspect); inspect();
    });
  }
  clearFiles(): Promise<void> {
    return this.queue.run(async () => {
      await this.load();
      const state = structuredClone(this.state);
      const keep = (entry: QueueEntry) => {
        if (entry.source !== 'files') return true;
        if (!entry.execution) return false;
        entry.status = 'stopping'; return true;
      };
      state.tasks = state.tasks.filter(keep); state.sends = state.sends.filter(keep);
      await this.commit(state);
    });
  }
  removeFile(id: string, remove: () => Promise<void>): Promise<void> {
    return this.queue.run(async () => {
      await this.load();
      if (this.fileUpload?.itemId === id) this.fileUpload.abort.abort();
      await remove();
      const items = await this.files!.items(), state = structuredClone(this.state);
      state.sends = state.sends.filter(send => {
        if (send.source !== 'files' || send.fileId !== id) return true;
        if (!send.execution) return false;
        send.execution.sourceInvalidated = true; send.status = 'stopping'; return true;
      });
      state.tasks = state.tasks.filter(task => {
        if (task.source !== 'files') return true;
        if (!items.length) {
          if (!task.execution) return false;
          task.execution.sourceInvalidated = true; task.status = 'stopping'; return true;
        }
        const affected = task.nextItemId === id || task.highlightedItemId === id || task.preparation?.itemId === id ||
          task.preparedItemId === id || task.retryExecution?.itemId === id || task.execution?.itemId === id;
        if (affected) {
          if (task.execution?.itemId === id) task.execution.sourceInvalidated = true;
          task.nextItemId = task.highlightedItemId = nextAutoItem(task, items)?.id;
          task.selectionRevision++;
          delete task.preparation; delete task.preparedItemId; delete task.retryExecution; delete task.fileError;
          if (task.reason === 'file' || task.reason === 'empty' || task.reason === 'failed') {
            task.status = 'queued'; task.retryCount = 0; delete task.reason; delete task.failureCode;
          }
        }
        task.orderIds = items.map(item => item.id); return true;
      });
      await this.commit(state);
    });
  }
  private async prepareFile(state: AutoState, entry: QueueEntry, itemId: string): Promise<void> {
    const token = crypto.randomUUID(), abort = new AbortController();
    entry.preparation = { token, itemId }; delete entry.fileError;
    this.filePreparations.set(entry.id, { token, abort });
    await this.commit(state);
    void this.files!.prepare(entry.tabId!, itemId, abort.signal).then(
      () => this.completePreparation(entry.id, token, itemId),
      error => this.completePreparation(entry.id, token, itemId, error instanceof Error ? error.message : 'Could not prepare image.'),
    ).catch(() => { /* Storage errors are published by commit. */ });
  }
  private completePreparation(id: string, token: string, itemId: string, error?: string): Promise<void> {
    return this.queue.run(async () => {
      const state = structuredClone(this.state), entry = this.entries(state).find(entry => entry.id === id && entry.preparation?.token === token);
      if (!entry) return;
      this.filePreparations.delete(id); delete entry.preparation;
      if (error) { this.pause(entry, 'file'); entry.fileError = error; }
      else entry.preparedItemId = itemId;
      await this.commit(state);
    });
  }
  async tick(): Promise<void> {
    const candidate = await this.queue.run(async () => {
      await this.load();
      if (this.fault) return;
      await this.libraryChanged();
      if (this.state.acceptedRequests.some(request => request.expiresAt <= this.now())) await this.commit(structuredClone(this.state));
      const state = structuredClone(this.state), now = this.now();
      const running = this.entries(state).find(task => task.execution);
      if (running) {
        if (running.execution!.deadline <= now) await this.finish(running.execution!.token, { status: 'paused', reason: 'unknown' });
        else this.schedule();
        return;
      }
      const task = this.ordered(state)[0];
      if (!task || this.availableAt(task, state) > now) { this.schedule(); return; }
      if (task.source === 'files') {
        const items = await this.files!.items();
        const id = manual(task) ? task.fileId : nextAutoItem(task, items)?.id;
        if (!id || !items.some(item => item.id === id)) { this.pause(task, 'empty'); await this.commit(state); return; }
        if (!manual(task)) { task.orderIds = items.map(item => item.id); task.nextItemId = task.highlightedItemId = id; }
        if (task.preparedItemId !== id) { await this.prepareFile(state, task, id); return; }
      }
      this.preparing.add(task.id);
      return task;
    });
    if (!candidate) return;
    // Keep Stop and manual Send responsive while asking a potentially slow tab.
    let items: { id: string; value?: string }[] = [], reason: PauseReason | undefined;
    let fileValue: string | undefined, fileError: string | undefined;
    try {
      if (!manual(candidate) && candidate.categoryId === 'default') items = await this.defaultImages?.items() ?? [];
      if (candidate.source === 'files') {
        const abort = new AbortController();
        const allowed = await this.queue.run(async () => {
          const current = this.entries().find(entry => entry.id === candidate.id);
          if (!current || current.status !== 'queued' || current.preparedItemId !== candidate.preparedItemId ||
            (!manual(current) && !manual(candidate) && current.selectionRevision !== candidate.selectionRevision)) return false;
          this.fileUpload = { id: candidate.id, itemId: candidate.preparedItemId!, abort }; return true;
        });
        try { if (allowed) fileValue = await this.files!.resolve(candidate.preparedItemId!, abort.signal, candidate.tabId!); else reason = 'interrupted'; }
        catch (error) { reason = 'file'; fileError = error instanceof Error ? error.message : 'Image upload failed.'; }
        finally { this.fileUpload = undefined; }
      }
    } catch { reason = 'failed'; }
    await this.queue.run(async () => {
      this.preparing.delete(candidate.id);
      if (this.fault) return;
      await this.libraryChanged();
      const state = structuredClone(this.state), task = this.entries(state).find(task => task.id === candidate.id);
      if (!task || task.status !== 'queued' ||
        this.availableAt(task, state) > this.now()) { this.schedule(); return; }
      if (this.entries(state).some(entry => entry.execution)) { this.schedule(); return; }
      // A choice made during preparation needs a fresh view of its source.
      if (!manual(task) && !manual(candidate) && task.selectionRevision !== candidate.selectionRevision) { this.schedule(); return; }
      if (reason) {
        if (fileError) task.fileError = fileError;
        if (reason === 'busy') { task.reason = 'busy'; task.readinessAt = this.now() + sendQueueLimits.readinessPollMs; }
        else this.pause(task, reason);
        await this.commit(state); return;
      }
      // A manual click received during preparation has priority over a recurring task.
      if (!manual(task) && this.ordered(state).some(entry => manual(entry) && this.availableAt(entry, state) <= this.now())) { this.schedule(); return; }
      delete task.readinessAt;
      if (manual(task)) {
        task.status = 'running'; delete task.reason;
        task.execution = { token: crypto.randomUUID(), receiver: task.receiver, command: task.parameters.key,
          parameters: task.parameters, value: fileValue, selectionRevision: 0, deadline: this.now() + autoSendLimits.resultTimeoutMs };
        await this.dispatch(state, task); return;
      }
      // Re-read after the probe while library writes and dispatch share the same queue.
      items = await this.items(task, items as { id: string; value: string }[]);
      if (task.retryExecution && task.command !== 'sendOrDelete' && !items.some(item => item.id === task.retryExecution!.itemId)) {
        delete task.retryExecution; task.retryCount = 0; delete task.failureCode;
      }
      if (task.retryExecution) {
        task.status = 'running';
        task.execution = { ...task.retryExecution, ...(fileValue === undefined ? {} : { value: fileValue }), token: crypto.randomUUID(), deadline: this.now() + autoSendLimits.resultTimeoutMs };
        await this.dispatch(state, task); return;
      }
      const item = nextAutoItem(task, items);
      if (task.command !== 'sendOrDelete' && !item) {
        this.pause(task, 'empty'); await this.commit(state); return;
      }
      task.orderIds = items.map(item => item.id); task.nextItemId = item?.id;
      task.highlightedItemId = item?.id;
      task.status = 'running';
      task.execution = { token: crypto.randomUUID(), receiver: task.receiver, command: task.command,
        parameters: task.parameters, value: fileValue ?? item?.value, itemId: item?.id, selectionRevision: task.selectionRevision,
        deadline: this.now() + autoSendLimits.resultTimeoutMs };
      await this.dispatch(state, task);
    });
  }
  private async dispatch(state: AutoState, task: QueueEntry): Promise<void> {
    await this.commit(state);
    const token = task.execution!.token;
    const execution = this.transport.execute(task.execution!);
    void execution.then(
      outcome => this.result(token, outcome),
      () => this.result(token, { status: 'paused', reason: 'unknown' }),
    ).catch(() => { /* commit published the storage failure */ });
  }
  private result(token: string, outcome: AutoOutcome): Promise<void> {
    return this.queue.run(() => this.finish(token, outcome));
  }
  private async finish(token: string, outcome: AutoOutcome): Promise<void> {
    const state = structuredClone(this.state), task = this.entries(state).find(task => task.execution?.token === token);
    if (!task) return;
    const now = this.now();
    const beforeClick = outcome.status === 'paused' && ['busy', 'unavailable', 'interrupted'].includes(outcome.reason);
    if (!beforeClick) this.cooldown(state, task, now);
    const remove = () => {
      if (manual(task)) state.sends = state.sends.filter(entry => entry !== task);
      else state.tasks = state.tasks.filter(entry => entry !== task);
    };
    if (manual(task) && this.manualOutcomes.has(task.id) && (outcome.status === 'success' || outcome.reason === 'unknown')) this.manualOutcomes.set(task.id, outcome.status === 'success' ? 'success' : 'failed');
    if (task.status === 'stopping') remove();
    else if (task.execution?.sourceInvalidated) {
      if (outcome.status === 'paused' && outcome.reason === 'unknown') this.notice(state, task);
      if (!manual(task)) this.advance(task, now);
    } else if (outcome.status === 'success' || outcome.reason === 'unknown') {
      if (outcome.status !== 'success') this.notice(state, task);
      if (manual(task)) remove(); else this.advance(task, now);
    } else if (outcome.reason === 'failed' || outcome.reason === 'busy') {
      const count = outcome.reason === 'failed' ? (task.retryCount ?? 0) + 1 : task.retryCount ?? 0;
      task.retryCount = count;
      if (outcome.reason === 'failed') task.failureCode = outcome.failureCode;
      const base = task.receiver.startsWith('group:') ? sendQueueLimits.groupMs : sendQueueLimits.userMs;
      const delay = outcome.reason === 'busy' ? sendQueueLimits.readinessPollMs :
        Math.max(outcome.retryAfterMs ?? 0, Math.min(sendQueueLimits.retryMaxMs, base * 2 ** Math.min(count - 1, 5)));
      if (!manual(task) && outcome.reason === 'failed') task.retryExecution = task.execution;
      task.status = outcome.reason === 'failed' && count > sendQueueLimits.maxRetries ? 'paused' : 'queued';
      task.reason = outcome.reason;
      if (outcome.reason === 'busy') task.readinessAt = now + delay;
      else task.dueAt = now + delay;
      delete task.execution;
      if (manual(task) && outcome.reason === 'failed') task.sequence = ++state.sequence;
    } else { task.failureCode = outcome.failureCode; this.pause(task, outcome.reason); }
    if (this.fault) for (const candidate of this.entries(state)) this.pause(candidate, 'storage');
    await this.reconcileSources(state);
    await this.commit(state);
  }
}
