import { createInfoButton } from '../ui/info-tip';
import type { MediaAccessPort } from '../media/ports/media-access-port';

const copy = {
  granted: 'CtrlEm can read media on the sites you visit.',
  missing: 'Allow CtrlEm to read media on websites. Without it, send controls do not appear.',
  denied: 'Access was not granted. You can allow it when ready.',
  failure: 'Couldn’t request access. Try again.',
} as const;

/** The permission request stays directly in an extension-page click, before any await. */
export function mountWebsiteAccess(document: Document, access: MediaAccessPort, root: HTMLElement, requestAccess?: () => Promise<boolean>): void {
  const section = document.createElement('section'); section.className = 'ctrlem-db-settings-block';
  section.innerHTML = `<div class="ctrlem-db-field-heading"><h2>Website access</h2></div>
    <p data-site-access role="status"></p>
    <button type="button" data-site-allow>Allow website access</button>`;
  section.querySelector('.ctrlem-db-field-heading')!.append(createInfoButton(document, 'About website access',
    'Grants CtrlEm permission to read images and video on sites you visit. Nothing is sent anywhere until you send a file.'));
  const status = section.querySelector<HTMLElement>('[data-site-access]')!;
  const allow = section.querySelector<HTMLButtonElement>('[data-site-allow]')!;
  const show = (granted: boolean) => {
    allow.hidden = granted; allow.disabled = false;
    status.textContent = granted ? copy.granted : copy.missing;
  };
  const check = async () => { try { show(await access.granted()); } catch { status.textContent = copy.failure; allow.hidden = false; allow.disabled = false; } };
  allow.onclick = () => {
    if (!requestAccess) { void access.openSettings(); return; }
    // Firefox needs the original click, before any async work.
    const result = requestAccess();
    allow.disabled = true;
    void result.then(granted => { show(granted); if (!granted) status.textContent = copy.denied; },
      () => { allow.disabled = false; status.textContent = copy.failure; });
  };
  access.subscribe(show);
  root.prepend(section);
  void check();
}
