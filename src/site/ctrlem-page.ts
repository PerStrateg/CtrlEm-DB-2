const selectors = {
  commandsHeader: '.panel--commands .panel-head',
  resultsPanel: '.panel--results',
  resultsHeader: ':scope > .panel-head',
};

export interface PageTargets {
  commandsHeader: HTMLElement | null;
  resultsPanel: HTMLElement | null;
  resultsHeader: HTMLElement | null;
}

export interface ResultsMount {
  setOpen(open: boolean): void;
  dispose(): void;
}

/** Owns the site's selectors and the reversible changes to its containers. */
export class CtrlEmPage {
  constructor(readonly document: Document) {}

  findTargets(): PageTargets {
    const resultsPanel = this.document.querySelector<HTMLElement>(selectors.resultsPanel);
    return {
      commandsHeader: this.document.querySelector<HTMLElement>(selectors.commandsHeader),
      resultsPanel,
      resultsHeader: resultsPanel?.querySelector<HTMLElement>(selectors.resultsHeader) ?? null,
    };
  }

  observe(onChange: () => void): () => void {
    const observer = new MutationObserver(onChange);
    observer.observe(this.document, { childList: true, subtree: true });
    return () => observer.disconnect();
  }

  mountLauncher(header: HTMLElement, launcher: HTMLElement): () => void {
    header.classList.add('ctrlem-db-commands-header');
    header.append(launcher);
    return () => {
      launcher.remove();
      header.classList.remove('ctrlem-db-commands-header');
    };
  }

  mountResults(panel: HTMLElement, header: HTMLElement, library: HTMLElement): ResultsMount {
    // Preserve every native node, its listeners, hidden state and live updates.
    // CSS replaces the native view while open; no innerHTML snapshots are used.
    header.after(library);
    return {
      setOpen: (open) => panel.classList.toggle('ctrlem-db-results-open', open),
      dispose: () => {
        panel.classList.remove('ctrlem-db-results-open');
        library.remove();
      },
    };
  }
}
