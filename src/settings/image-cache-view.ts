import { createInfoButton } from '../ui/info-tip';
import { imageCacheAccess, imageCacheLimits } from '../shared/image-cache-protocol';
import type { ImageCacheSettingsRequest, ImageCacheStatus } from '../shared/image-cache-protocol';
import type { Reply } from '../shared/library-protocol';

export function mountImageCacheSettings(document: Document, root: HTMLElement = document.querySelector('main')!): void {
  const section = document.createElement('section');
  section.innerHTML = `<div class="ctrlem-db-field-heading"><h2>Image storage</h2></div>
    <p data-cache-access role="status"></p>
    <button type="button" data-cache-enable>Enable image caching</button>
    <label>Cache limit <select aria-label="Image cache limit"></select></label>
    <p data-cache-usage></p>
    <div class="ctrlem-db-actions"><button type="button" data-cache-clear>Clear cache</button>
    <button type="button" data-cache-refresh>Refresh cache status</button></div>
    <p data-cache-status role="status"></p>`;
  section.querySelector('.ctrlem-db-field-heading')!.append(createInfoButton(document, 'About image storage', 'Keeps copies on this device so images load faster next time. Older copies are removed when storage fills up.'));
  const select = section.querySelector('select')!;
  for (const mib of imageCacheLimits) {
    const option = document.createElement('option'); option.value = String(mib * 1024 ** 2);
    option.textContent = mib < 1024 ? `${mib} MiB` : `${mib / 1024} GiB`; select.append(option);
  }
  const enable = section.querySelector<HTMLButtonElement>('[data-cache-enable]')!;
  const clear = section.querySelector<HTMLButtonElement>('[data-cache-clear]')!;
  const refresh = section.querySelector<HTMLButtonElement>('[data-cache-refresh]')!;
  const status = section.querySelector<HTMLElement>('[data-cache-status]')!;
  const access = section.querySelector<HTMLElement>('[data-cache-access]')!;
  const usage = section.querySelector<HTMLElement>('[data-cache-usage]')!;
  const busy = (value: boolean) => { select.disabled = clear.disabled = refresh.disabled = enable.disabled = value; };
  const update = async (message: ImageCacheSettingsRequest) => {
    busy(true); status.textContent = message.type === 'image-cache:clear' ? 'Clearing…' : message.type === 'image-cache:limit' ? '' : 'Loading…';
    try {
      const reply: Reply<ImageCacheStatus> = await chrome.runtime.sendMessage(message);
      if (!reply.ok) throw new Error();
      const value = reply.value;
      select.value = String(value.limit);
      usage.textContent = `${(value.bytes / 1024 ** 2).toFixed(1)} MiB used · ${value.count} images`;
      access.textContent = value.access ? '' : 'Allow access to image hosts to keep a persistent cache. Images still display without it.';
      enable.hidden = value.access;
      status.textContent = message.type === 'image-cache:clear' ? 'Cache cleared. Visible images will load again.' : '';
      busy(false);
    } catch {
      status.textContent = message.type === 'image-cache:limit' ? '' : 'Couldn’t update image cache. Use Refresh cache status to retry.';
      if (message.type === 'image-cache:limit') busy(false);
      refresh.disabled = false; enable.disabled = false;
    }
  };
  enable.onclick = () => {
    if (document.defaultView!.top !== document.defaultView) { void chrome.runtime.openOptionsPage(); return; }
    // Firefox needs the original click, before any async work.
    const permission = chrome.permissions.request(imageCacheAccess);
    busy(true);
    void permission.then(async granted => {
      await update({ type: 'image-cache:status' });
      status.textContent = granted ? 'Image caching enabled.' : 'Access was not granted. Images will display without persistent caching.';
    }, () => { busy(false); status.textContent = 'Couldn’t request access. Try again.'; });
  };
  select.onchange = () => { void update({ type: 'image-cache:limit', bytes: Number(select.value) }); };
  clear.onclick = () => { void update({ type: 'image-cache:clear' }); };
  refresh.onclick = () => { void update({ type: 'image-cache:status' }); };
  root.append(section);
  void update({ type: 'image-cache:status' });
}
