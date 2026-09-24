/** Accept a web URL or a bare domain; store a usable absolute URL. */
export function normalizeWebAddress(value: string): string | undefined {
  // URL() would otherwise silently strip whitespace inside a pasted address.
  if (/\s/.test(value)) return;
  if (/^https?:\/\//i.test(value)) return URL.canParse(value) ? value : undefined;

  // A scheme-free address must start with a domain, not a phrase, relative path
  // or another URI scheme. URL() validates the resulting host and optional port.
  const authority = value.split(/[/?#]/, 1)[0]!;
  if (!authority.includes('.') || authority.includes('@')) return;
  const absolute = `https://${value}`;
  return URL.canParse(absolute) ? absolute : undefined;
}
