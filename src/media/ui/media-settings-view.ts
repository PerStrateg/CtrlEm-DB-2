import { mediaSettingsSchema, type MediaSettings } from '../domain/media-settings';
import type { MediaSettingsPort } from '../ports/media-settings-port';
import type { MediaAccessPort } from '../ports/media-access-port';
import { createInfoButton } from '../../ui/info-tip';

const mediaCopy = {
  enabled: 'Adds CtrlEm send controls to images and videos on sites you visit.',
  excluded: 'Sites in this list never get CtrlEm media controls.',
  accessMissing: 'Allow website access in CtrlEm settings so send controls can appear.',
} as const;

export interface MediaAccessUi {
  access: MediaAccessPort;
  refreshTab?: number;
}

export class MediaSettingsView {
  readonly element: HTMLElement;
  private value?: MediaSettings;
  private accessGranted: boolean;
  private needsRefresh = false;
  private readonly accessSettings: HTMLButtonElement;
  private stopAccess?: () => void;
  private readonly enabled: HTMLInputElement;
  private readonly exclude: HTMLButtonElement;
  private readonly excluded: HTMLDivElement;
  private readonly status: HTMLParagraphElement;
  private readonly retry: HTMLButtonElement;
  private readonly notice: HTMLParagraphElement;
  private readonly refresh: HTMLButtonElement;
  private saveTail = Promise.resolve();

  constructor(private readonly document: Document, private readonly client: MediaSettingsPort,
    private readonly activeHost?: string, private readonly accessUi?: MediaAccessUi) {
    this.accessGranted = accessUi === undefined;
    this.element = document.createElement('section'); this.element.className = 'ctrlem-media-settings ctrlem-db-ui';
    this.element.innerHTML = `<header><span class="ctrlem-brand">C</span><div><strong>Media</strong><small>CtrlEm</small></div></header>
      <p class="ctrlem-access-notice" data-access role="status" hidden></p>
      <button class="ctrlem-site-action" data-access-settings type="button" hidden>Open settings</button>
      <button class="ctrlem-site-action" data-refresh-tab type="button" hidden>Refresh current tab</button>
      <label class="ctrlem-setting"><span><strong>Enabled</strong><small>Show send controls</small></span><input data-enabled type="checkbox" disabled></label>
      <button class="ctrlem-site-action" data-exclude type="button" hidden></button>
      <details><summary>Excluded sites <span data-count></span></summary><div class="ctrlem-excluded" data-excluded></div></details>
      <p class="ctrlem-settings-status" data-status role="status">Loading…</p>
      <button data-retry type="button" hidden>Retry</button>`;
    this.enabled = this.element.querySelector('[data-enabled]')!;
    this.exclude = this.element.querySelector('[data-exclude]')!;
    this.excluded = this.element.querySelector('[data-excluded]')!;
    this.status = this.element.querySelector('[data-status]')!;
    this.retry = this.element.querySelector('[data-retry]')!;
    this.notice = this.element.querySelector('[data-access]')!;
    this.refresh = this.element.querySelector('[data-refresh-tab]')!;
    this.accessSettings = this.element.querySelector('[data-access-settings]')!;
    this.accessSettings.onclick = () => void this.accessUi!.access.openSettings();
    this.retry.onclick = () => void this.load();
    this.refresh.onclick = () => { if (this.accessUi?.refreshTab !== undefined) { this.needsRefresh = false; this.renderAccess(); void chrome.tabs.reload(this.accessUi.refreshTab); } };
    this.enabled.previousElementSibling!.append(createInfoButton(document, 'What Enabled does', mediaCopy.enabled));
    this.excluded.closest('details')!.querySelector('summary')!.append(createInfoButton(document, 'Why exclude sites', mediaCopy.excluded));
    this.notice.append(document.createTextNode(mediaCopy.accessMissing));
    this.notice.append(createInfoButton(document, 'Why controls are missing', mediaCopy.accessMissing));
    this.enabled.onchange = () => this.update({ ...this.value!, enabled: this.enabled.checked });
    this.exclude.onclick = () => this.toggleHost();
    if (accessUi) {
      const changed = (granted: boolean) => { this.accessGranted = granted; this.needsRefresh ||= !granted; this.renderAccess(); };
      this.stopAccess = accessUi.access.subscribe(changed);
      void accessUi.access.granted().then(changed, () => changed(false));
    }
  }

  async load(): Promise<void> {
    this.retry.hidden = true;
    this.status.classList.remove('error');
    this.status.textContent = 'Loading…';
    try { this.value = await this.client.load(); this.status.textContent = ''; this.render(); }
    catch { this.status.textContent = 'Couldn’t load settings.'; this.status.classList.add('error'); this.retry.hidden = false; }
  }

  private toggleHost(): void {
    if (!this.value || !this.activeHost) return;
    const hosts = new Set(this.value.excludedHosts); hosts.has(this.activeHost) ? hosts.delete(this.activeHost) : hosts.add(this.activeHost);
    this.update({ ...this.value, excludedHosts: [...hosts].sort() });
  }

  private update(input: MediaSettings): void {
    const candidate = mediaSettingsSchema.parse(input); this.value = candidate; this.render();
    const save = async () => {
      try { this.value = await this.client.save(candidate); this.status.textContent = ''; }
      catch { this.value = await this.client.load().catch(() => candidate); this.status.textContent = 'Couldn’t save. Retry.'; }
      this.render();
    };
    this.saveTail = this.saveTail.then(save, save);
  }

  private renderAccess(): void {
    this.notice.hidden = this.accessGranted;
    this.accessSettings.hidden = this.accessGranted;
    this.refresh.hidden = !this.accessGranted || !this.needsRefresh || this.accessUi?.refreshTab === undefined;
    this.enabled.disabled = !this.value || !this.accessGranted;
    // Without access the stored preference cannot take effect on any site.
    this.enabled.checked = this.accessGranted && this.value?.enabled === true;
  }

  private render(): void {
    if (!this.value) return;
    this.enabled.disabled = false;
    this.enabled.checked = this.value.enabled; this.exclude.hidden = !this.activeHost;
    this.renderAccess();
    if (this.activeHost) this.exclude.textContent = this.value.excludedHosts.includes(this.activeHost) ? `Allow ${this.activeHost}` : `Exclude ${this.activeHost}`;
    this.element.querySelector('[data-count]')!.textContent = this.value.excludedHosts.length ? `(${this.value.excludedHosts.length})` : '';
    this.excluded.replaceChildren(...this.value.excludedHosts.map(host => {
      const row = this.document.createElement('div'); row.className = 'ctrlem-excluded-row';
      const label = this.document.createElement('span'); label.textContent = host;
      const remove = createInfoButton(this.document, `Allow ${host}`, 'Click to allow this site again.');
      remove.className = 'ctrlem-db-remove-button'; remove.textContent = '×';
      remove.onclick = () => this.update({ ...this.value!, excludedHosts: this.value!.excludedHosts.filter(item => item !== host) });
      row.append(label, remove); return row;
    }));
  }
}
