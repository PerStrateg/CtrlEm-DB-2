import type { ChangeResult, Library, LibraryChange } from '../model/library';
import type { EditorSession, LibraryClient, LibraryRequest, LoadedLibrary, Reply } from '../shared/library-protocol';
import type { CommandKey } from '../model/commands';
import type { LoadedPicker, PickerClient, PickerSelection } from '../shared/picker-protocol';

export class ExtensionLibraryClient implements LibraryClient, PickerClient {
  private async request<T>(request: LibraryRequest): Promise<T> {
    const reply: Reply<T> = await chrome.runtime.sendMessage(request);
    if (!reply.ok) throw new Error(reply.error);
    return reply.value;
  }
  load(): Promise<LoadedLibrary> { return this.request({ type: 'library:load' }); }
  loadPicker(): Promise<LoadedPicker> { return this.request({ type: 'picker:load' }); }
  select(command: CommandKey, selection: PickerSelection): Promise<void> {
    return this.request({ type: 'picker:select', command, selection });
  }
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
