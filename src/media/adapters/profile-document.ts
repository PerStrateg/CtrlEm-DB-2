const profileDisplayNameSelectors = ['#profile-display-name', '[data-profile-display-name]', '.profile-display-name', '.profile-name'];

export function profileDisplayName(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const heading = profileDisplayNameSelectors.map(selector => document.querySelector(selector)).find(Boolean);
  heading?.querySelectorAll('.verified-badge').forEach(badge => badge.remove());
  const name = heading?.textContent?.trim() ?? '';
  if (!name) throw new Error('CtrlEm profile has no display name.');
  return name;
}
