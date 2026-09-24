import { CtrlEmPage } from '../site/ctrlem-page';
import type { ResultsMount } from '../site/ctrlem-page';
import { LibraryLauncher } from '../ui/library-launcher';
import { LibraryShell, libraryRegionId } from '../ui/library-shell';

/** Coordinates view state; it neither sends commands nor reads/writes library data. */
export class LibraryController {
  private readonly launcher: LibraryLauncher;
  private readonly shell: LibraryShell;
  private commandsHeader: HTMLElement | null = null;
  private resultsPanel: HTMLElement | null = null;
  private resultsHeader: HTMLElement | null = null;
  private unmountLauncher?: () => void;
  private resultsMount?: ResultsMount;
  private stopObserving?: () => void;
  private hasMounted = false;
  private open = false;

  constructor(private readonly page: CtrlEmPage) {
    this.shell = new LibraryShell(page.document);
    this.launcher = new LibraryLauncher(page.document, libraryRegionId, () => this.toggle());
  }

  start(): void {
    this.stopObserving?.();
    this.stopObserving = this.page.observe(() => this.reconcile());
    this.reconcile();
  }

  private reconcile(): void {
    const { commandsHeader, resultsPanel, resultsHeader } = this.page.findTargets();
    // Initial mounting waits for both panels; later disappearance gets a visible status.
    if (!this.hasMounted && !(commandsHeader && resultsPanel && resultsHeader)) return;
    this.hasMounted = true;

    if (this.commandsHeader !== commandsHeader ||
        (commandsHeader && this.launcher.element.parentElement !== commandsHeader)) {
      this.unmountLauncher?.();
      this.unmountLauncher = undefined;
      this.commandsHeader = commandsHeader;
      if (commandsHeader) {
        this.unmountLauncher = this.page.mountLauncher(commandsHeader, this.launcher.element);
      }
    }

    if (this.resultsPanel !== resultsPanel || this.resultsHeader !== resultsHeader ||
        (resultsPanel && resultsHeader && this.shell.element.parentElement !== resultsPanel)) {
      this.resultsMount?.dispose();
      this.resultsMount = undefined;
      this.resultsPanel = resultsPanel;
      this.resultsHeader = resultsHeader;
      if (resultsPanel && resultsHeader) {
        this.resultsMount = this.page.mountResults(resultsPanel, resultsHeader, this.shell.element);
      }
    }

    const available = Boolean(this.resultsMount);
    this.launcher.render({ open: this.open && available, available });
    this.shell.setOpen(this.open && available);
    this.resultsMount?.setOpen(this.open);
  }

  private toggle(): void {
    // The page can change between a click and the MutationObserver notification.
    this.reconcile();
    if (!this.resultsMount) return;
    this.open = !this.open;
    this.reconcile();
    if (this.open) this.shell.focus();
    else this.launcher.focus();
  }

  dispose(): void {
    this.stopObserving?.();
    this.unmountLauncher?.();
    this.resultsMount?.dispose();
    this.launcher.dispose();
  }
}
