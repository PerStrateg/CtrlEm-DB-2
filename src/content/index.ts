import { CtrlEmPage } from '../site/ctrlem-page';
import { LibraryController } from '../library/library-controller';
import { EditorController } from '../library/editor-controller';
import { ExtensionLibraryClient } from '../library/extension-library-client';
import { PickerController } from '../library/picker-controller';
import { CommandFields } from '../site/command-fields';
import { CaptureController } from '../library/capture-controller';
import { TransferController } from '../library/transfer-controller';
import '../site/ctrlem-page.css';
import '../ui/library.css';
import '../ui/library-editor.css';
import '../ui/content-picker.css';
import '../ui/media-preview.css';

// This global belongs to the extension's isolated world, not the page's scripts.
// Reinjection replaces the previous controller and releases its DOM bindings.
const runtime = globalThis as typeof globalThis & {
  ctrlEmLibraryController?: { dispose(): void };
};

runtime.ctrlEmLibraryController?.dispose();
const shell = new LibraryController(new CtrlEmPage(document), () => editor.flushActive());
const client = new ExtensionLibraryClient();
let transfer: TransferController | undefined;
const editor = new EditorController(shell.content, client, dirty => { shell.setUnsaved(dirty); transfer?.refresh(); });
transfer = new TransferController(editor.view.element, client, editor);
const fields = new CommandFields(document);
const pickers = new PickerController(fields, client, (type, id, create, initiator) => {
  shell.openFrom(initiator);
  editor.openCategory(type, id, create);
});
const capture = new CaptureController(fields, client, (key, value) => pickers.isDefaultValue(key, value));
runtime.ctrlEmLibraryController = { dispose: () => { capture.dispose(); transfer?.dispose(); pickers.dispose(); editor.dispose(); shell.dispose(); } };
shell.start();
editor.start();
pickers.start();
capture.start();
