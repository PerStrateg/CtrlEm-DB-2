import { requestSchema } from '../shared/library-protocol';
import type { LibraryRequest } from '../shared/library-protocol';
import { EditorSessionRepository, LibraryRepository, WriteQueue } from '../storage/library-store';
import { SelectionRepository } from '../storage/selection-store';
import { receiverFromUrl } from '../model/send-command';
import { commands } from '../model/commands';

export function authorizedTab(sender: chrome.runtime.MessageSender, extensionId: string): number | undefined {
  if (sender.id !== extensionId || sender.frameId !== 0 || sender.tab?.id === undefined || !sender.url) return;
  if (receiverFromUrl(sender.url)) return sender.tab.id;
}

export class LibraryService {
  constructor(private readonly library: LibraryRepository, private readonly sessions: EditorSessionRepository,
    private readonly selections: SelectionRepository, private readonly queue = new WriteQueue(),
    private readonly libraryChanged: () => Promise<void> = async () => {}) {}

  handle(tabId: number, input: unknown, receiver?: string): Promise<unknown> {
    const request = requestSchema.parse(input);
    return this.queue.run(async () => {
      const result = await this.execute(tabId, request, receiver);
      if ((request.type === 'library:change' || request.type === 'library:import') &&
          (result as { status: string }).status === 'saved') {
        // A committed library must not be reported as failed because task storage failed.
        // The scheduler publishes its fault and blocks dispatch until recovery.
        await this.libraryChanged().catch(() => console.warn('[CtrlEm DB] Task sources could not be synchronized.'));
      }
      return result;
    });
  }
  private async execute(tabId: number, request: LibraryRequest, receiver?: string): Promise<unknown> {
    switch (request.type) {
      case 'picker:load':
      case 'picker:select': {
        if (!receiver) throw new Error('Receiver is required.');
        return request.type === 'picker:load'
          ? { library: await this.library.read(), selections: await this.selections.read(receiver) }
          : this.selections.save(receiver, request.command, request.selection);
      }
      case 'library:load': return { library: await this.library.read(), session: await this.sessions.read(tabId) };
      case 'library:add-upload': return this.library.addUpload(commands[request.command].type, request.addition);
      case 'library:change': return this.library.change(request.change);
      case 'library:session': return this.sessions.save(tabId, request.session);
      case 'library:capture': return this.library.capture(commands[request.command].type, request.value);
      case 'library:import': return this.library.import(request.file, request.mode, request.baseRevision);
    }
  }
  removeTab(tabId: number): Promise<void> { return this.queue.run(() => this.sessions.remove(tabId)); }
}
