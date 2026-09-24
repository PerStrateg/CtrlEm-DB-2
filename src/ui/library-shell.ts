export const libraryRegionId = 'ctrlem-db-library';

/** Owns placement and the persistent content container; editors own their state. */
export class LibraryShell {
  readonly element: HTMLElement;
  readonly content: HTMLDivElement;
  private readonly heading: HTMLHeadingElement;

  constructor(document: Document) {
    this.element = document.createElement('section');
    this.element.id = libraryRegionId;
    this.element.className = 'ctrlem-db-library';
    this.element.hidden = true;
    this.element.setAttribute('aria-labelledby', `${libraryRegionId}-title`);

    const header = document.createElement('header');
    header.className = 'ctrlem-db-library-header';
    this.heading = document.createElement('h2');
    this.heading.id = `${libraryRegionId}-title`;
    this.heading.textContent = 'Library';
    this.heading.tabIndex = -1;
    const description = document.createElement('p');
    description.textContent = 'Manage reusable content.';
    header.append(this.heading, description);

    this.content = document.createElement('div');
    this.content.className = 'ctrlem-db-library-content';
    this.element.append(header, this.content);
  }

  setOpen(open: boolean): void {
    this.element.hidden = !open;
  }

  focus(): void {
    this.heading.focus({ preventScroll: true });
  }
}
