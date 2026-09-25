export const libraryRegionId = 'ctrlem-db-library';

/** Owns placement and the persistent content container; editors own their state. */
export class LibraryShell {
  readonly element: HTMLElement;
  readonly content: HTMLDivElement;
  private readonly heading: HTMLHeadingElement;
  private readonly settings: HTMLDivElement;
  private readonly libraryButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly back: HTMLButtonElement;

  constructor(document: Document) {
    this.element = document.createElement('section');
    this.element.id = libraryRegionId;
    this.element.className = 'ctrlem-db-library ctrlem-db-ui';
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
    const navigation = document.createElement('nav');
    navigation.setAttribute('aria-label', 'Library sections');
    this.libraryButton = document.createElement('button');
    this.libraryButton.textContent = 'Categories';
    this.settingsButton = document.createElement('button');
    this.settingsButton.textContent = 'Settings';
    this.settings = document.createElement('div');
    this.settings.className = 'ctrlem-db-settings';
    this.back = document.createElement('button');
    this.back.type = 'button';
    this.back.textContent = 'Back to upload';
    this.back.hidden = true;
    this.libraryButton.onclick = () => this.showCategories();
    this.settingsButton.onclick = () => {
      if (!this.settings.firstChild) {
        const frame = document.createElement('iframe');
        frame.title = 'Upload provider settings';
        frame.src = chrome.runtime.getURL('settings.html');
        this.settings.append(frame);
      }
      this.content.hidden = true;
      this.settings.hidden = false;
      this.libraryButton.setAttribute('aria-pressed', 'false');
      this.settingsButton.setAttribute('aria-pressed', 'true');
    };
    this.libraryButton.type = this.settingsButton.type = 'button';
    navigation.append(this.libraryButton, this.settingsButton, this.back);
    this.element.append(header, navigation, this.content, this.settings);
    this.showCategories();
  }

  showCategories(): void {
    this.content.hidden = false;
    this.settings.hidden = true;
    this.libraryButton.setAttribute('aria-pressed', 'true');
    this.settingsButton.setAttribute('aria-pressed', 'false');
    this.back.hidden = true;
  }

  showSettings(back: () => void): void {
    this.settingsButton.click();
    this.back.hidden = false;
    this.back.onclick = back;
  }

  setOpen(open: boolean): void {
    this.element.hidden = !open;
  }

  focus(): void {
    this.heading.focus({ preventScroll: true });
  }
}
