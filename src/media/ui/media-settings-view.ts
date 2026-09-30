import { mediaSettingsSchema, type MediaSettings } from '../domain/media-settings';
import type { MediaSettingsPort } from '../ports/media-settings-port';

export class MediaSettingsView {
  readonly element: HTMLElement;
  private value?: MediaSettings;
  private readonly enabled: HTMLInputElement;
  private readonly wallpaper: HTMLInputElement;
  private readonly exclude: HTMLButtonElement;
  private readonly excluded: HTMLDivElement;
  private readonly status: HTMLParagraphElement;
  private saveTail = Promise.resolve();

  constructor(private readonly document: Document, private readonly client: MediaSettingsPort,
    private readonly activeHost?: string) {
    this.element = document.createElement('section'); this.element.className = 'ctrlem-media-settings';
    this.element.innerHTML = `<header><span class="ctrlem-brand">C</span><div><strong>Media</strong><small>CtrlEm</small></div></header>
      <label class="ctrlem-setting"><span><strong>Enabled</strong><small>Show media controls</small></span><input data-enabled type="checkbox"></label>
      <label class="ctrlem-setting"><span><strong>Wallpaper</strong><small>Show wallpaper action</small></span><input data-wallpaper type="checkbox"></label>
      <button class="ctrlem-site-action" data-exclude type="button" hidden></button>
      <details><summary>Excluded sites <span data-count></span></summary><div class="ctrlem-excluded" data-excluded></div></details>
      <p class="ctrlem-settings-status" data-status role="status">Loading…</p>`;
    this.enabled = this.element.querySelector('[data-enabled]')!; this.wallpaper = this.element.querySelector('[data-wallpaper]')!;
    this.exclude = this.element.querySelector('[data-exclude]')!; this.excluded = this.element.querySelector('[data-excluded]')!;
    this.status = this.element.querySelector('[data-status]')!;
    this.enabled.onchange = () => this.update({ ...this.value!, enabled: this.enabled.checked });
    this.wallpaper.onchange = () => this.update({ ...this.value!, showWallpaper: this.wallpaper.checked });
    this.exclude.onclick = () => this.toggleHost();
  }

  async load(): Promise<void> {
    try { this.value = await this.client.load(); this.status.textContent = ''; this.render(); }
    catch { this.status.textContent = 'Couldn’t load settings.'; this.status.classList.add('error'); }
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

  private render(): void {
    if (!this.value) return;
    this.enabled.checked = this.value.enabled; this.wallpaper.checked = this.value.showWallpaper; this.exclude.hidden = !this.activeHost;
    if (this.activeHost) this.exclude.textContent = this.value.excludedHosts.includes(this.activeHost) ? `Allow ${this.activeHost}` : `Exclude ${this.activeHost}`;
    this.element.querySelector('[data-count]')!.textContent = this.value.excludedHosts.length ? `(${this.value.excludedHosts.length})` : '';
    this.excluded.replaceChildren(...this.value.excludedHosts.map(host => {
      const row = this.document.createElement('div'); row.className = 'ctrlem-excluded-row';
      const label = this.document.createElement('span'); label.textContent = host;
      const remove = this.document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = `Allow ${host}`;
      remove.onclick = () => this.update({ ...this.value!, excludedHosts: this.value!.excludedHosts.filter(item => item !== host) });
      row.append(label, remove); return row;
    }));
  }
}
