import { CtrlEmPage } from '../site/ctrlem-page';
import { LibraryController } from '../library/library-controller';
import '../site/ctrlem-page.css';
import '../ui/library.css';

// This global belongs to the extension's isolated world, not the page's scripts.
// Reinjection replaces the previous controller and releases its DOM bindings.
const runtime = globalThis as typeof globalThis & {
  ctrlEmLibraryController?: LibraryController;
};

runtime.ctrlEmLibraryController?.dispose();
runtime.ctrlEmLibraryController = new LibraryController(new CtrlEmPage(document));
runtime.ctrlEmLibraryController.start();
