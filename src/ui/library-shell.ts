import { createHelpAbout } from './help-about';
import { contentTypes, typeLabels, type ContentType } from '../model/library';

export const libraryRegionId = 'ctrlem-db-library';
type Section = ContentType | 'settings' | 'help';

/** Owns navigation and persistent containers; the editor owns drafts and active content type. */
export class LibraryShell {
  readonly element: HTMLElement;
  readonly content: HTMLDivElement;
  readonly database: HTMLDivElement;
  private readonly heading: HTMLHeadingElement;
  private readonly settings: HTMLDivElement;
  private readonly help: HTMLElement;
  private readonly back: HTMLButtonElement;
  private readonly tabs = new Map<Section, HTMLButtonElement>();
  private activeType: ContentType = 'link';
  private section: Section = 'link';
  private frame?: HTMLIFrameElement;
  private readonly receiveHeight: (event: MessageEvent) => void;
  onSelectType?: (type: ContentType) => void;

  constructor(private readonly document: Document) {
    this.element = document.createElement('section');
    this.element.id = libraryRegionId;
    this.element.className = 'ctrlem-db-library ctrlem-db-ui';
    this.element.hidden = true;
    this.element.setAttribute('aria-labelledby', `${libraryRegionId}-title`);
    const header = document.createElement('header'); header.className = 'ctrlem-db-library-header';
    this.heading = document.createElement('h2'); this.heading.id = `${libraryRegionId}-title`; this.heading.tabIndex = -1;
    const author = document.createElement('a'); author.textContent = 'Strateg';
    author.href = 'https://ctrlem.com/u/KPD0M'; author.target = '_blank'; author.rel = 'noopener noreferrer';
    this.heading.append('Ctrlem DB by ', author);
    const description = document.createElement('p'); description.textContent = 'Edit links, text, images, sounds, and videos.';
    header.append(this.heading, description);
    const navigation = document.createElement('nav'); navigation.setAttribute('aria-label', 'Library sections');
    navigation.setAttribute('role', 'tablist');
    this.content = document.createElement('div'); this.content.className = 'ctrlem-db-library-content'; this.content.id = 'ctrlem-db-content';
    this.settings = document.createElement('div'); this.settings.className = 'ctrlem-db-settings'; this.settings.id = 'ctrlem-db-settings';
    this.help = createHelpAbout(document, chrome.runtime.getManifest().version); this.help.id = 'ctrlem-db-help';
    for (const panel of [this.content, this.settings, this.help]) panel.setAttribute('role', 'tabpanel');
    const sections: Section[] = [...contentTypes, 'settings', 'help'];
    for (const section of sections) {
      const tab = document.createElement('button'); tab.type = 'button'; tab.id = `ctrlem-db-tab-${section}`;
      tab.textContent = section === 'settings' ? 'Settings' : section === 'help' ? 'Help & About' : typeLabels[section];
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', section === 'settings' ? this.settings.id : section === 'help' ? this.help.id : this.content.id);
      tab.onclick = () => {
        this.select(section);
        if (section !== 'settings' && section !== 'help') this.onSelectType?.(section);
      };
      tab.onkeydown = event => {
        let index = sections.indexOf(section);
        if (event.key === 'ArrowRight') index = (index + 1) % sections.length;
        else if (event.key === 'ArrowLeft') index = (index + sections.length - 1) % sections.length;
        else if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = sections.length - 1;
        else return;
        event.preventDefault();
        for (const button of this.tabs.values()) button.tabIndex = -1;
        const next = this.tabs.get(sections[index]!)!; next.tabIndex = 0; next.focus();
      };
      this.tabs.set(section, tab); navigation.append(tab);
    }
    this.back = document.createElement('button'); this.back.type = 'button'; this.back.textContent = 'Back to upload'; this.back.hidden = true;
    this.database = document.createElement('div'); this.database.className = 'ctrlem-db-database';
    this.back.className = 'ctrlem-db-settings-back';
    this.settings.append(this.database, this.back);
    this.receiveHeight = event => {
      const frame = this.frame;
      // Only the embedded extension document may size its own container. No data or credentials cross this boundary.
      if (!frame || event.source !== frame.contentWindow || event.origin !== new URL(frame.src).origin) return;
      if (event.data?.type !== 'ctrlem-db:settings-height' || !Number.isFinite(event.data.height) || event.data.height <= 0) return;
      frame.style.height = `${Math.ceil(event.data.height)}px`;
    };
    document.defaultView!.addEventListener('message', this.receiveHeight);
    this.element.append(header, navigation, this.content, this.settings, this.help);
    this.select('link');
  }

  private select(section: Section): void {
    this.section = section;
    this.content.hidden = section === 'settings' || section === 'help';
    this.settings.hidden = section !== 'settings'; this.help.hidden = section !== 'help'; this.back.hidden = true;
    if (section === 'settings' && !this.frame) {
      this.frame = this.document.createElement('iframe'); this.frame.title = 'Extension settings';
      this.frame.src = chrome.runtime.getURL('settings.html'); this.settings.append(this.frame);
    }
    if (section !== 'settings' && section !== 'help') this.activeType = section;
    for (const [key, tab] of this.tabs) { tab.setAttribute('aria-selected', String(key === section)); tab.tabIndex = key === section ? 0 : -1; }
    const panel = section === 'settings' ? this.settings : section === 'help' ? this.help : this.content;
    panel.setAttribute('aria-labelledby', `ctrlem-db-tab-${section}`);
  }
  setActiveType(type: ContentType): void {
    if (this.activeType === type) return;
    this.activeType = type;
    if (this.section !== 'settings' && this.section !== 'help') this.select(type);
  }
  showCategories(): void { this.select(this.activeType); }
  showSettings(back: () => void): void { this.select('settings'); this.back.hidden = false; this.back.onclick = back; }
  setOpen(open: boolean): void { this.element.hidden = !open; }
  focus(): void { this.heading.focus({ preventScroll: true }); }
  dispose(): void { this.document.defaultView!.removeEventListener('message', this.receiveHeight); }
}
