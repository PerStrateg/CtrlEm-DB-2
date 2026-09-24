import { requestSchema } from '../shared/library-protocol';
import type { LibraryRequest } from '../shared/library-protocol';
import { EditorSessionRepository, LibraryRepository, WriteQueue } from '../storage/library-store';

export function authorizedTab(sender: chrome.runtime.MessageSender, extensionId: string): number | undefined {
  if (sender.id !== extensionId || sender.frameId !== 0 || sender.tab?.id === undefined || !sender.url) return;
  const url = new URL(sender.url);
  if (url.origin === 'https://ctrlem.com' && /^\/u\/[^/]+\/?$/.test(url.pathname)) return sender.tab.id;
}

export class LibraryService {
  private readonly queue = new WriteQueue();
  constructor(private readonly library: LibraryRepository, private readonly sessions: EditorSessionRepository) {}

  handle(tabId: number, input: unknown): Promise<unknown> {
    const request = requestSchema.parse(input);
    return this.queue.run(() => this.execute(tabId, request));
  }
  private async execute(tabId: number, request: LibraryRequest): Promise<unknown> {
    switch (request.type) {
      case 'library:load': return { library: await this.library.read(), session: await this.sessions.read(tabId) };
      case 'library:change': return this.library.change(request.change);
      case 'library:session': return this.sessions.save(tabId, request.session);
    }
  }
  removeTab(tabId: number): Promise<void> { return this.queue.run(() => this.sessions.remove(tabId)); }
}
