import { CtrlEmPage } from '../site/ctrlem-page';
import { LibraryController } from '../library/library-controller';
import { EditorController } from '../library/editor-controller';
import { ExtensionLibraryClient } from '../library/extension-library-client';
import { PickerController } from '../library/picker-controller';
import { CommandFields } from '../site/command-fields';
import '../site/ctrlem-page.css';
import '../ui/library.css';
import '../ui/library-editor.css';
import '../ui/content-picker.css';

// This global belongs to the extension's isolated world, not the page's scripts.
// Reinjection replaces the previous controller and releases its DOM bindings.
const runtime = globalThis as typeof globalThis & {
  ctrlEmLibraryController?: { dispose(): void };
};

runtime.ctrlEmLibraryController?.dispose();
const shell = new LibraryController(new CtrlEmPage(document), () => editor.flushActive());
const client = new ExtensionLibraryClient();
const editor = new EditorController(shell.content, client, dirty => shell.setUnsaved(dirty));
const pickers = new PickerController(new CommandFields(document), client, (type, id, create, initiator) => {
  shell.openFrom(initiator);
  editor.openCategory(type, id, create);
});
runtime.ctrlEmLibraryController = { dispose: () => { pickers.dispose(); editor.dispose(); shell.dispose(); } };
shell.start();
editor.start();
pickers.start();
