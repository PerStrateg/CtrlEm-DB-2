import { ExtensionMediaSettingsClient } from '../media/adapters/extension-media-settings-client';
import { mediaSettingsSchema, type MediaRecipient, type MediaSettings } from '../media/domain/media-settings';
import './popup.css';

const client = new ExtensionMediaSettingsClient();
const elements = {
  enabled: required<HTMLInputElement>('enabled'), wallpaper: required<HTMLInputElement>('wallpaper'),
  selected: required<HTMLDivElement>('selected'), selectedCount: required<HTMLElement>('selected-count'),
  recipients: required<HTMLDivElement>('recipients'), search: required<HTMLInputElement>('search'),
  exclude: required<HTMLButtonElement>('exclude'), excluded: required<HTMLDivElement>('excluded'),
  excludedCount: required<HTMLElement>('excluded-count'), status: required<HTMLParagraphElement>('status'),
};
let settings: MediaSettings;
let recipients: MediaRecipient[] = [];
let activeKind: MediaRecipient['kind'] = 'group';
let activeHost: string | undefined;
let saveTail: Promise<void> = Promise.resolve();

void initialize();

async function initialize(): Promise<void> {
  try {
    const [loaded, host] = await Promise.all([client.load(), currentHost()]);
    settings = loaded; activeHost = host; bind(); render();
    recipients = (await client.recipients()).sort((left, right) => left.label.localeCompare(right.label));
    renderDirectory();
  } catch (error) { fail(error); }
}
function bind(): void {
  elements.enabled.addEventListener('change', () => update({ ...settings, enabled: elements.enabled.checked }));
  elements.wallpaper.addEventListener('change', () => update({ ...settings, showWallpaper: elements.wallpaper.checked }));
  elements.search.addEventListener('input', renderDirectory);
  elements.exclude.addEventListener('click', () => {
    if (!activeHost) return;
    const excluded = new Set(settings.excludedHosts);
    excluded.has(activeHost) ? excluded.delete(activeHost) : excluded.add(activeHost);
    update({ ...settings, excludedHosts: [...excluded].sort() });
  });
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) tab.addEventListener('click', () => {
    activeKind = tab.dataset.kind as MediaRecipient['kind'];
    document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item === tab));
    renderDirectory();
  });
}

function update(next: MediaSettings): void {
  const candidate = mediaSettingsSchema.parse(next);
  settings = candidate; render();
  const persist = () => client.save(candidate).then(saved => {
    if (settings === candidate) { settings = saved; clearStatus(); render(); }
  }, async error => {
    if (settings === candidate) {
      try { settings = await client.load(); } catch { /* Keep the visible candidate for retry context. */ }
      fail(error); render();
    }
  });
  saveTail = saveTail.then(persist, persist);
}

function toggle(recipient: MediaRecipient): void {
  const exists = settings.selectedRecipients.some(item => item.receiver === recipient.receiver);
  const selectedRecipients = exists ? settings.selectedRecipients.filter(item => item.receiver !== recipient.receiver)
    : [...settings.selectedRecipients, recipient];
  update({ ...settings, selectedRecipients });
}

function render(): void {
  elements.enabled.checked = settings.enabled;
  elements.wallpaper.checked = settings.showWallpaper;
  document.body.classList.toggle('disabled', !settings.enabled);
  elements.selected.replaceChildren(...settings.selectedRecipients.map(recipient => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'chip';
    button.textContent = `${recipient.kind === 'group' ? 'G' : 'P'} · ${recipient.label}`;
    button.title = `Remove ${recipient.label}`; button.addEventListener('click', () => toggle(recipient)); return button;
  }));
  if (!settings.selectedRecipients.length) elements.selected.append(message('Choose recipients'));
  elements.selectedCount.textContent = String(settings.selectedRecipients.length);
  elements.exclude.hidden = !activeHost;
  if (activeHost) elements.exclude.textContent = settings.excludedHosts.includes(activeHost) ? `Allow ${activeHost}` : `Exclude ${activeHost}`;
  elements.excludedCount.textContent = settings.excludedHosts.length ? `(${settings.excludedHosts.length})` : '';
  elements.excluded.replaceChildren(...settings.excludedHosts.map(host => {
    const row = document.createElement('div'); row.className = 'excluded-row';
    const name = document.createElement('span'); name.textContent = host;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = `Allow ${host}`;
    remove.addEventListener('click', () => update({ ...settings, excludedHosts: settings.excludedHosts.filter(item => item !== host) }));
    row.append(name, remove); return row;
  }));
  renderDirectory();
}

function renderDirectory(): void {
  if (!settings) return;
  const query = elements.search.value.trim().toLocaleLowerCase();
  const visible = recipients.filter(recipient => recipient.kind === activeKind && recipient.label.toLocaleLowerCase().includes(query));
  if (!visible.length) { elements.recipients.replaceChildren(message(recipients.length ? 'Nothing found' : 'Loading…')); return; }
  elements.recipients.replaceChildren(...visible.map(recipient => {
    const selected = settings.selectedRecipients.some(item => item.receiver === recipient.receiver);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'recipient';
    button.setAttribute('aria-pressed', String(selected));
    const mark = document.createElement('span'); mark.className = 'recipient-mark'; mark.textContent = selected ? '✓' : '';
    const name = document.createElement('span'); name.className = 'recipient-name'; name.textContent = recipient.label;
    button.append(mark, name); button.addEventListener('click', () => toggle(recipient)); return button;
  }));
}

function message(text: string): HTMLParagraphElement {
  const element = document.createElement('p'); element.className = 'muted'; element.textContent = text; return element;
}
function clearStatus(): void { elements.status.textContent = ''; elements.status.classList.remove('error'); }
function fail(error: unknown): void {
  elements.status.textContent = error instanceof Error ? error.message : 'Couldn’t load CtrlEm.';
  elements.status.classList.add('error');
}
async function currentHost(): Promise<string | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { const url = new URL(tab?.url ?? ''); return ['http:', 'https:'].includes(url.protocol) ? url.hostname.toLowerCase() : undefined; }
  catch { return undefined; }
}
function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id); if (!element) throw new Error(`Missing popup element: ${id}`); return element as T;
}

