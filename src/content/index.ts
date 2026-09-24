import { CtrlEmPage } from '../site/ctrlem-page';
import { LibraryController } from '../library/library-controller';
import { EditorController } from '../library/editor-controller';
import { ExtensionLibraryClient } from '../library/extension-library-client';
import '../site/ctrlem-page.css';
import '../ui/library.css';
import '../ui/library-editor.css';

// This global belongs to the extension's isolated world, not the page's scripts.
// Reinjection replaces the previous controller and releases its DOM bindings.
const runtime = globalThis as typeof globalThis & {
  ctrlEmLibraryController?: { dispose(): void };
};

runtime.ctrlEmLibraryController?.dispose();
const shell = new LibraryController(new CtrlEmPage(document), () => editor.flushActive());
const editor = new EditorController(shell.content, new ExtensionLibraryClient(), dirty => shell.setUnsaved(dirty));
runtime.ctrlEmLibraryController = { dispose: () => { editor.dispose(); shell.dispose(); } };
shell.start();
editor.start();
