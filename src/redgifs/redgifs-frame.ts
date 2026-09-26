export function isRedgifsBrowseHref(href: string): boolean {
  try {
    const url = new URL(href);
    if (url.hostname !== 'www.redgifs.com' && url.hostname !== 'redgifs.com') {
      return false;
    }
    if (url.protocol !== 'https:') return false;
    if (url.pathname.startsWith('/~')) return false;
    return true;
  } catch {
    return false;
  }
}
