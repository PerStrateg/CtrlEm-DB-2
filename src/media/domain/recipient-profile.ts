export const recipientProfileLimits = {
  codeCharacters: 32, maxBytes: 1024 * 1024, timeoutMs: 15_000,
  codePattern: /^[A-Za-z0-9]{1,32}$/,
} as const;

export function controlCodeFromQuery(query: string): string | null {
  const trimmed = query.trim();
  const fromLink = /^https:\/\/ctrlem\.com\/u\/([^/?#]+)$/i.exec(trimmed);
  let code: string;
  try { code = fromLink ? decodeURIComponent(fromLink[1] ?? '') : trimmed; } catch { return null; }
  return recipientProfileLimits.codePattern.test(code) ? code : null;
}
export const profileUrl = (code: string): string => `https://ctrlem.com/u/${encodeURIComponent(code)}`;
