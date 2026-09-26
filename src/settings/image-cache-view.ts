import { imageCacheAccess, imageCacheLimits } from '../shared/image-cache-protocol';
import type { ImageCacheSettingsRequest, ImageCacheStatus } from '../shared/image-cache-protocol';
import type { Reply } from '../shared/library-protocol';

export function mountImageCacheSettings(document: Document): void {
  const section = document.createElement('section');
  section.innerHTML = `<h2>Image cache</h2>
    <p>Keep viewed images on this device. Images stay cached until you clear them or the cache fills up.</p>
    <p data-cache-access role="status"></p>
    <button type="button" data-cache-enable>Enable image caching</button>
    <label>Cache limit <select aria-label="Image cache limit"></select></label>
    <p data-cache-usage></p>
    <button type="button" data-cache-clear>Clear cache</button>
    <button type="button" data-cache-refresh>Refresh cache status</button>
    <p data-cache-status role="status"></p>`;
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
    busy(true); status.textContent = message.type === 'image-cache:clear' ? 'Clearing…' : 'Loading…';
    try {
      const reply: Reply<ImageCacheStatus> = await chrome.runtime.sendMessage(message);
      if (!reply.ok) throw new Error();
      const value = reply.value;
      select.value = String(value.limit);
      usage.textContent = `${(value.bytes / 1024 ** 2).toFixed(1)} MiB used · ${value.count} images`;
      access.textContent = value.access ? 'Access enabled for image hosts.' : 'Allow access to image hosts to keep a persistent cache. Images still display without it.';
      enable.hidden = value.access;
      status.textContent = value.writeFailed ? 'Couldn’t save an image to disk. Free disk space or clear the cache.'
        : message.type === 'image-cache:clear' ? 'Cache cleared. Visible images will load again.'
          : message.type === 'image-cache:limit' ? 'Saved' : '';
      busy(false);
    } catch {
      status.textContent = 'Couldn’t update image cache. Use Refresh cache status to retry.';
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
      if (!granted) status.textContent = 'Access was not granted. Images will display without persistent caching.';
    }, () => { busy(false); status.textContent = 'Couldn’t request access. Try again.'; });
  };
  select.onchange = () => { void update({ type: 'image-cache:limit', bytes: Number(select.value) }); };
  clear.onclick = () => { void update({ type: 'image-cache:clear' }); };
  refresh.onclick = () => { void update({ type: 'image-cache:status' }); };
  document.querySelector('main')!.append(section);
  void update({ type: 'image-cache:status' });
}
