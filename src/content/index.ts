import { mountInfoTips } from '../ui/info-tip';
import '../ui/info-tip.css';
import { CtrlEmPage } from '../site/ctrlem-page';
import { LibraryController } from '../library/library-controller';
import { EditorController } from '../library/editor-controller';
import { ExtensionLibraryClient } from '../library/extension-library-client';
import { PickerController } from '../library/picker-controller';
import { CommandFields } from '../site/command-fields';
import { CaptureController } from '../library/capture-controller';
import { TransferController } from '../library/transfer-controller';
import { UploadController } from '../upload/upload-controller';
import { ExtensionUploadClient } from '../upload/extension-upload-client';
import { AutoSendPage } from '../site/auto-send-page';
import { AutoSendController } from '../auto-send/auto-send-controller';
import { ExtensionAutoClient, bindAutoExecutor } from '../auto-send/extension-auto-client';
import { IntervalController } from '../auto-send/interval-controller';
import { ExtensionIntervalClient } from '../auto-send/extension-interval-client';
import { commands, commandKeys } from '../model/commands';
import '../site/ctrlem-page.css';
import '../ui/common.css';
import '../ui/library.css';
import '../ui/library-editor.css';
import '../ui/content-picker.css';
import '../ui/media-preview.css';
import '../ui/file-upload.css';
import '../ui/auto-send.css';
import '../ui/redgifs.css';
import { ResultsController } from '../ui/results-controller';
import { RedgifsController } from '../redgifs/redgifs-controller';
import { FilesController } from '../files/files-controller';
import '../ui/files.css';
import { diagnosticCommand, recordDiagnostic, startDiagnosticSession } from '../diagnostics/session-log';
import { observeSiteErrors } from '../site/result-errors';
import { bindDiagnosticRelay } from '../diagnostics/relay';

// This global belongs to the extension's isolated world, not the page's scripts.
// Reinjection replaces the previous controller and releases its DOM bindings.
const runtime = globalThis as typeof globalThis & {
  ctrlEmLibraryController?: { dispose(): void };
};

runtime.ctrlEmLibraryController?.dispose();
startDiagnosticSession(document, chrome.runtime.getManifest().version);
const stopSiteErrors = observeSiteErrors(document, error => recordDiagnostic('site.error', {
  command: diagnosticCommand(error.command), code: error.code, status: error.status, existing: error.existing, outcome: 'failed',
}));
const unbindDiagnostics = bindDiagnosticRelay();
const stopInfoTips = mountInfoTips(document);
const page = new CtrlEmPage(document);
const results = new ResultsController();
const shell = new LibraryController(page, () => editor.flushActive(), results);
const client = new ExtensionLibraryClient();
let transfer: TransferController | undefined;
const editor = new EditorController(shell.content, client, () => { transfer?.refresh(); }, type => shell.setActiveType(type));
shell.bindTypeSelection(type => editor.selectType(type));
transfer = new TransferController(shell.database, client, editor);
const fields = new CommandFields(document);
const pickers = new PickerController(fields, client, (type, id, create, initiator) => {
  shell.openFrom(initiator);
  editor.openCategory(type, id, create);
}, undefined, (categoryId, itemId) => editor.removeItem(categoryId, itemId), results);
const capture = new CaptureController(fields, client, (key, value) => pickers.isDefaultValue(key, value));
const uploads = new UploadController(fields, client, new ExtensionUploadClient(), pickers,
  (initiator, back) => shell.openSettings(initiator, back));
const autoPage = new AutoSendPage(document, fields);
const unbindAuto = bindAutoExecutor(autoPage);
const autoSend = new AutoSendController(autoPage, fields, pickers, new ExtensionAutoClient(), command => {
  const key = commandKeys.find(key => key === command.key);
  if (key) { const value = command.fields.find(field => field.id === commands[key].fieldId)?.value;
    if (value !== undefined) capture.accepted(key, value); }
}, new IntervalController(new ExtensionIntervalClient()));
const redgifs = new RedgifsController(page, results, async url => {
  const command = autoPage.native.capture('videoOverlay', false);
  command.fields = command.fields.map(field => field.id === commands.videoOverlay.fieldId ? { ...field, value: url } : field);
  await autoSend.queueCommand(command);
});
const files = new FilesController(page, results, fields, autoPage);
runtime.ctrlEmLibraryController = { dispose: () => { recordDiagnostic('session.end'); unbindDiagnostics(); stopSiteErrors(); stopInfoTips(); files.dispose(); redgifs.dispose(); autoSend.dispose(); unbindAuto(); uploads.dispose(); capture.dispose(); transfer?.dispose(); pickers.dispose(); editor.dispose(); shell.dispose(); } };
shell.start();
editor.start();
pickers.start();
capture.start();
uploads.start();
autoSend.start();

redgifs.start();
files.start();
