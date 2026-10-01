const profileDisplayNameSelector = '#profile-display-name';

export function profileDisplayName(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const heading = document.querySelector(profileDisplayNameSelector);
  heading?.querySelectorAll('.verified-badge').forEach(badge => badge.remove());
  const name = heading?.textContent?.trim() ?? '';
  if (!name) throw new Error('CtrlEm profile has no display name.');
  return name;
}
