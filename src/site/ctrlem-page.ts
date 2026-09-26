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

  mountRedgifsLauncher(button: HTMLElement): void {
    const heading = this.document.querySelector<HTMLElement>('[data-acc="videoOverlay"]');
    if (!heading) return;
    const parent = heading.parentElement!;
    if (!parent.classList.contains('ctrlem-db-video-heading')) {
      const row = this.document.createElement('div');
      row.className = 'ctrlem-db-video-heading';
      heading.before(row); row.append(heading, button);
    } else if (button.parentElement !== parent) parent.append(button);
  }

  mountFilesLauncher(button: HTMLElement): void {
    const heading = this.document.querySelector<HTMLElement>('[data-acc="popupImage"]');
    if (!heading) return;
    const parent = heading.parentElement!;
    if (!parent.classList.contains('ctrlem-db-image-heading')) {
      const row = this.document.createElement('div'); row.className = 'ctrlem-db-image-heading';
      heading.before(row); row.append(heading, button);
    } else if (button.parentElement !== parent) parent.append(button);
  }
  removeFilesLauncher(button: HTMLElement): void {
    const row = button.parentElement; button.remove();
    if (row?.classList.contains('ctrlem-db-image-heading')) row.replaceWith(...row.childNodes);
  }
  mountFiles(panel: HTMLElement, content: HTMLElement): ResultsMount {
    panel.append(content);
    return { setOpen: open => panel.classList.toggle('ctrlem-db-files-open', open),
      dispose: () => { panel.classList.remove('ctrlem-db-files-open'); content.remove(); } };
  }

  removeRedgifsLauncher(button: HTMLElement): void {
    const row = button.parentElement;
    button.remove();
    if (row?.classList.contains('ctrlem-db-video-heading')) row.replaceWith(...row.childNodes);
  }

  mountRedgifs(panel: HTMLElement, content: HTMLElement): ResultsMount {
    panel.append(content);
    return {
      setOpen: open => panel.classList.toggle('ctrlem-db-redgifs-open', open),
      dispose: () => { panel.classList.remove('ctrlem-db-redgifs-open'); content.remove(); },
    };
  }

  redgifsHeight(): number {
    const win = this.document.defaultView!;
    const navHeight = this.document.querySelector('nav.navbar')?.getBoundingClientRect().height ?? 0;
    return Math.max(564, Math.round((win.visualViewport?.height ?? win.innerHeight) - navHeight - 16));
  }

  alignResults(panel: HTMLElement): void {
    const navHeight = this.document.querySelector('nav.navbar')?.getBoundingClientRect().height ?? 0;
    this.document.defaultView?.scrollBy(0, panel.getBoundingClientRect().top - navHeight);
  }
}
