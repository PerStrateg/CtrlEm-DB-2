import { catboxAccess } from '../shared/provider-access';

/** The permission request stays directly in an extension-page click handler. */
export function mountProviderAccess(document: Document, permissions: Pick<typeof chrome.permissions, 'contains' | 'request'>, root: HTMLElement = document.querySelector('main')!): void {
  const section = document.createElement('section');
  const title = document.createElement('h4'); title.textContent = 'Upload access';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const allow = document.createElement('button'); allow.textContent = 'Allow Catbox uploads'; allow.hidden = true;
  const retry = document.createElement('button'); retry.textContent = 'Retry access check'; retry.hidden = true;
  section.append(title, status, allow, retry);
  root.append(section);
  const show = (granted: boolean, justGranted = false) => {
    section.hidden = granted && !justGranted;
    allow.hidden = granted; allow.disabled = false;
    status.textContent = granted ? (justGranted ? 'Access enabled. Return to CtrlEm to upload.' : '') : 'Allow this extension to upload your audio to Catbox.';
  };
  const check = async () => {
    allow.hidden = true; retry.hidden = true; status.textContent = 'Checking Catbox access…';
    try { show(await permissions.contains(catboxAccess)); }
    catch { status.textContent = 'Couldn’t check Catbox access.'; retry.hidden = false; }
  };
  allow.onclick = () => {
    // No await before request: Firefox requires the original user activation.
    const result = permissions.request(catboxAccess);
    allow.disabled = true;
    void result.then(granted => {
      show(granted, granted);
      if (!granted) status.textContent = 'Access was not granted. You can allow it when ready.';
    }, () => { allow.disabled = false; status.textContent = 'Couldn’t request access. Try again.'; });
  };
  retry.onclick = () => { void check(); };
  void check();
}
