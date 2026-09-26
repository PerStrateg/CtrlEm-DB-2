import { rgError } from './rg-debug';
const SCOPE = 'redgifs-api';
export function createVideoResolver() {
  let token = '';
  let tokenAt = 0;
  return async (slug: string): Promise<string | null> => {
    if (!token || Date.now() - tokenAt > 50 * 60 * 1000) {
      const auth = await fetch('https://api.redgifs.com/v2/auth/temporary', {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
      });
      const body = (await auth.json()) as { token?: string };
      if (!auth.ok || !body.token) {
        rgError(SCOPE, 'api: auth failed', { status: auth.status });
        return null;
      }
      token = body.token;
      tokenAt = Date.now();
    }

    const res = await fetch(
      `https://api.redgifs.com/v2/gifs/${encodeURIComponent(slug)}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'omit',
        cache: 'no-store',
      },
    );
    const body = (await res.json().catch(() => null)) as {
      gif?: { urls?: { hd?: string; sd?: string } };
      error?: unknown;
    } | null;
    if (!res.ok) {
      rgError(SCOPE, 'api: gif lookup failed', {
        slug,
        status: res.status,
        body,
      });
      return null;
    }
    const urls = body?.gif?.urls;
    const url =
      [urls?.hd, urls?.sd].find(
        (candidate) =>
          typeof candidate === 'string' && /\.mp4(\?|#|$)/i.test(candidate),
      ) || null;
    return url;
  };

}
