import type { ChangeResult, Library, LibraryChange } from '../model/library';
import type { EditorSession, LibraryClient, LibraryRequest, LoadedLibrary, Reply } from '../shared/library-protocol';
import type { CommandKey } from '../model/commands';
import type { LoadedPicker, PickerClient, PickerSelection } from '../shared/picker-protocol';
import type { CaptureClient, TransferClient } from '../shared/library-protocol';
import type { CaptureResult } from '../model/input-capture';
import type { ImportMode, ImportResult, LibraryFile } from '../model/library-file';
import type { UploadAddition, UploadAdditionResult } from '../model/upload-addition';
import { classifyDiagnosticError, recordDiagnostic } from '../diagnostics/session-log';

export class ExtensionLibraryClient implements LibraryClient, PickerClient, CaptureClient, TransferClient {
  private async request<T>(request: LibraryRequest): Promise<T> {
    const started = performance.now();
    try {
      const reply: Reply<T> = await chrome.runtime.sendMessage(request);
      if (!reply.ok) throw new Error(reply.error);
      const conflict = (reply.value as { status?: string } | undefined)?.status === 'conflict';
      // Routine picker reads and autosaves are noisy; keep failures, conflicts,
      // slow operations and explicit changes, without serializing their payload.
      if (conflict || performance.now() - started > 1000 || !['picker:load', 'picker:select', 'library:session'].includes(request.type)) {
        recordDiagnostic('library', { request: request.type, outcome: conflict ? 'conflict' : 'success', durationMs: Math.round(performance.now() - started) });
      }
      return reply.value;
    } catch (error) {
      recordDiagnostic('library', { request: request.type, outcome: 'failed', durationMs: Math.round(performance.now() - started), code: classifyDiagnosticError(error) });
      throw error;
    }
  }
  load(): Promise<LoadedLibrary> { return this.request({ type: 'library:load' }); }
  addUpload(command: 'popupImage' | 'changeWallpaper' | 'popupSound' | 'videoOverlay', addition: UploadAddition): Promise<UploadAdditionResult> {
    return this.request({ type: 'library:add-upload', command, addition });
  }
  capture(command: CommandKey, value: string): Promise<CaptureResult> { return this.request({ type: 'library:capture', command, value }); }
  import(file: LibraryFile, mode: ImportMode, baseRevision: number): Promise<ImportResult> {
    return this.request({ type: 'library:import', file, mode, baseRevision });
  }
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
