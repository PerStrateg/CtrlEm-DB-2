import type { ChangeResult, Library, LibraryChange } from '../model/library';
import type { EditorSession, LibraryClient, LibraryRequest, LoadedLibrary, Reply } from '../shared/library-protocol';

export class ExtensionLibraryClient implements LibraryClient {
  private async request<T>(request: LibraryRequest): Promise<T> {
    const reply: Reply<T> = await chrome.runtime.sendMessage(request);
    if (!reply.ok) throw new Error(reply.error);
    return reply.value;
  }
  load(): Promise<LoadedLibrary> { return this.request({ type: 'library:load' }); }
  change(change: LibraryChange): Promise<ChangeResult> { return this.request({ type: 'library:change', change }); }
  saveSession(session: EditorSession): Promise<void> { return this.request({ type: 'library:session', session }); }
  subscribe(listener: (library: Library) => void): () => void {
    const onMessage = (message: { type?: string; library: Library }, sender: chrome.runtime.MessageSender) => {
      if (sender.id === chrome.runtime.id && !sender.tab && message.type === 'library:changed') listener(message.library);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }
}
