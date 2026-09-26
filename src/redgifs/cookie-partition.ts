import { rgWarn } from './rg-debug';
import { webExtensionApi } from './webextension-api';

export const CTRLEM_COOKIE_PARTITION = {
  topLevelSite: 'https://ctrlem.com',
} as const;

export type CtrlEmPartitionedCookie = {
  url: string;
  name: string;
  value: string;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
  storeId?: string;
};

type CookieLike = {
  name: string;
  value: string;
  domain: string;
  hostOnly?: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  session?: boolean;
  sameSite?: string;
  expirationDate?: number;
  storeId?: string;
  partitionKey?: { topLevelSite?: string };
  firstPartyDomain?: string;
};

type CookieQuery = {
  domain: string;
  partitionKey?: { topLevelSite: string };
  firstPartyDomain?: string | null;
};

type CookiesApi = {
  getAll: (details: CookieQuery) => Promise<CookieLike[]>;
  set: (details: {
    url: string;
    name: string;
    value: string;
    path?: string;
    domain?: string;
    secure?: boolean;
    httpOnly?: boolean;
    expirationDate?: number;
    sameSite: 'no_restriction';
    partitionKey?: { topLevelSite: string };
    firstPartyDomain?: string;
    storeId?: string;
  }) => Promise<unknown>;
  remove: (details: {
    url: string;
    name: string;
    partitionKey?: { topLevelSite: string };
    firstPartyDomain?: string;
    storeId?: string;
  }) => Promise<unknown>;
  onChanged: {
    addListener: (
      listener: (changeInfo: {
        removed: boolean;
        cookie: CookieLike;
      }) => void,
    ) => void;
  };
};

const SCOPE = 'cookie-partition';

export const EMBED_COOKIE_DOMAINS = [
  'redgifs.com',
] as const;

const IFRAME_SET_COOKIE_URLS = [
  'https://redgifs.com/*',
  'https://*.redgifs.com/*',
];

type HeadersReceivedDetails = {
  tabId: number;
  frameId: number;
  url: string;
  responseHeaders?: Array<{ name: string; value?: string }>;
};

type WebRequestApi = {
  OnHeadersReceivedOptions?: { EXTRA_HEADERS?: string };
  onHeadersReceived: {
    addListener: (
      listener: (details: HeadersReceivedDetails) => undefined,
      filter: { urls: string[]; types: string[] },
      extraInfoSpec: string[],
    ) => void;
  };
};

function cookiesApi(): CookiesApi | null {
  const browser = webExtensionApi();
  const api = browser?.cookies as unknown as CookiesApi | undefined;
  if (!api?.set) return null;
  return api;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'failed';
}

function isPartitioned(cookie: CookieLike): boolean {
  return Boolean(cookie.partitionKey?.topLevelSite);
}

function isEmbedCookie(cookie: CookieLike): boolean {
  return isPartitioned(cookie) || Boolean(cookie.firstPartyDomain);
}

async function getAllCookies(
  api: CookiesApi,
  details: CookieQuery,
): Promise<CookieLike[]> {
  return api.getAll(details);
}

/** Firefox FPI rejects getAll without firstPartyDomain; null returns every jar. */
async function listAccessibleCookies(
  api: CookiesApi,
  domain: string,
): Promise<{ cookies: CookieLike[]; error?: string }> {
  const errors: string[] = [];
  let cookies: CookieLike[] = [];
  try {
    cookies = await getAllCookies(api, { domain });
  } catch (error) {
    errors.push(errorMessage(error));
  }
  if (cookies.length === 0) {
    try {
      const all = await getAllCookies(api, { domain, firstPartyDomain: null });
      if (all.length > 0) cookies = all;
    } catch (error) {
      errors.push(`fpi:${errorMessage(error)}`);
    }
  }
  return {
    cookies,
    error:
      cookies.length === 0 && errors.length > 0 ? errors.join('; ') : undefined,
  };
}

function headersReceivedExtraInfoSpec(
  webRequest: WebRequestApi,
): string[] {
  const spec = ['responseHeaders'];
  if (webRequest.OnHeadersReceivedOptions?.EXTRA_HEADERS) {
    spec.push(webRequest.OnHeadersReceivedOptions.EXTRA_HEADERS);
  }
  return spec;
}

function cookieHost(cookie: CookieLike): string {
  return cookie.domain.replace(/^\./, '').toLowerCase();
}

function cookieUrl(cookie: CookieLike): string {
  return `https://${cookieHost(cookie)}${cookie.path || '/'}`;
}

function hostMatchesDomain(host: string, domain: string): boolean {
  const needle = domain.replace(/^\./, '').toLowerCase();
  return host === needle || host.endsWith(`.${needle}`);
}

/** Write one cookie into CtrlEm's embed partition (SameSite=None; Secure). */
export async function setCtrlEmPartitionedCookie(
  cookie: CtrlEmPartitionedCookie,
): Promise<void> {
  const api = cookiesApi();
  if (!api) return;
  const base = {
    url: cookie.url,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    ...(cookie.domain ? { domain: cookie.domain } : {}),
    secure: cookie.secure ?? true,
    httpOnly: cookie.httpOnly ?? false,
    ...(typeof cookie.expirationDate === 'number'
      ? { expirationDate: cookie.expirationDate }
      : {}),
    ...(cookie.storeId ? { storeId: cookie.storeId } : {}),
    sameSite: 'no_restriction' as const,
  };
  try {
    await api.set({
      ...base,
      partitionKey: CTRLEM_COOKIE_PARTITION,
    });
  } catch (error) {
    try {
      await api.set({
        ...base,
        firstPartyDomain: 'ctrlem.com',
      });
    } catch (retry) {
      rgWarn(SCOPE, 'failed to set partitioned cookie', {
        name: cookie.name,
        url: cookie.url,
        error,
        retry,
      });
    }
  }
}

export function parseSetCookieHeader(
  header: string,
  requestUrl?: string,
  nowSeconds = Date.now() / 1000,
): CtrlEmPartitionedCookie | null {
  const pair = header.match(/^([^=;\s]+)=([^;]*)/);
  if (!pair) return null;
  const attributes = new Map<string, string>();
  for (const part of header.split(';').slice(1)) {
    const [name, ...value] = part.trim().split('=');
    attributes.set(name!.toLowerCase(), value.join('=').trim());
  }
  const domain = attributes.get('domain');
  const request = requestUrl ? new URL(requestUrl) : null;
  // Reject cookies that the response origin is not allowed to set.
  if (domain && request && !hostMatchesDomain(request.hostname, domain)) return null;
  const pathname = request?.pathname || '/';
  const defaultPath = pathname.slice(0, pathname.lastIndexOf('/')) || '/';
  const pathAttribute = attributes.get('path');
  const path = pathAttribute?.startsWith('/') ? pathAttribute : defaultPath;
  const maxAge = attributes.get('max-age');
  const expires = Date.parse(attributes.get('expires') || '');
  const expirationDate = maxAge && /^-?\d+$/.test(maxAge)
    ? Math.max(0, nowSeconds + Number(maxAge))
    : Number.isFinite(expires) ? Math.max(0, expires / 1000) : undefined;
  return {
    url: request ? request.origin + path : '',
    name: pair[1]!,
    value: pair[2]!,
    path,
    ...(domain ? { domain } : {}),
    secure: true,
    httpOnly: attributes.has('httponly'),
    ...(expirationDate !== undefined ? { expirationDate } : {}),
  };
}

async function mirrorCookie(cookie: CookieLike): Promise<void> {
  if (isEmbedCookie(cookie)) return;
  await setCtrlEmPartitionedCookie({
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
    secure: true,
    httpOnly: cookie.httpOnly,
    storeId: cookie.storeId,
    ...(cookie.session || typeof cookie.expirationDate !== 'number'
      ? {}
      : { expirationDate: cookie.expirationDate }),
  });
}

/**
 * Copy first-party tab cookies into the CtrlEm iframe partition so the embed
 * can send the same session when Storage Access is not granted.
 */
function installUnpartitionedCookieMirror(domain: string): void {
  const api = cookiesApi();
  if (!api?.getAll || !api.onChanged) {
    rgWarn(SCOPE, 'cookies API unavailable — skip mirror', { domain });
    return;
  }

  const syncAll = async () => {
    const { cookies, error } = await listAccessibleCookies(api, domain);
    const tabCookies = cookies.filter((cookie) => !isEmbedCookie(cookie));
    for (const cookie of tabCookies) {
      await mirrorCookie(cookie);
    }
  };

  void syncAll().catch((error) => {
    rgWarn(SCOPE, 'initial cookie mirror failed', { domain, error });
  });

  api.onChanged.addListener((changeInfo) => {
    const cookie = changeInfo.cookie;
    if (!cookie || isEmbedCookie(cookie)) return;
    if (!hostMatchesDomain(cookieHost(cookie), domain)) return;

    if (changeInfo.removed) {
      void api
        .remove({
          url: cookieUrl(cookie),
          name: cookie.name,
          storeId: cookie.storeId,
          partitionKey: CTRLEM_COOKIE_PARTITION,
        })
        .catch(() =>
          api.remove({
            url: cookieUrl(cookie),
            name: cookie.name,
            storeId: cookie.storeId,
            firstPartyDomain: 'ctrlem.com',
          }),
        )
        .catch(() => undefined);
      return;
    }

    void mirrorCookie(cookie);
  });
}

function installIframeSetCookieBridge(): void {
  const browser = webExtensionApi();
  const webRequest = (browser as { webRequest?: WebRequestApi } | undefined)
    ?.webRequest;
  if (!webRequest?.onHeadersReceived) {
    rgWarn(SCOPE, 'webRequest unavailable — skip iframe Set-Cookie bridge');
    return;
  }

  const listener = (details: HeadersReceivedDetails): undefined => {
    if (details.tabId < 0 || details.frameId === 0) return undefined;
    const values = (details.responseHeaders || [])
      .filter((header) => header.name!.toLowerCase() === 'set-cookie')
      .map((header) => header.value || '')
      .filter(Boolean);
    if (values.length === 0) return undefined;

    const requestUrl = details.url;
    void browser.tabs.get(details.tabId).then((tab: { url?: string; cookieStoreId?: string }) => {
      let topHost = '';
      try {
        topHost = new URL(tab.url || '').hostname;
      } catch {
        return;
      }
      if (topHost !== 'ctrlem.com' && topHost !== 'www.ctrlem.com') return;

      for (const value of values) {
        const parsed = parseSetCookieHeader(value, requestUrl);
        if (!parsed) continue;
        void setCtrlEmPartitionedCookie({
          ...parsed,
          url: parsed.url,
          storeId: tab.cookieStoreId,
        });
      }
    }).catch(() => undefined);
    return undefined;
  };
  const filter = {
    urls: IFRAME_SET_COOKIE_URLS,
    types: ['xmlhttprequest', 'sub_frame'],
  };
  try {
    webRequest.onHeadersReceived.addListener(
      listener,
      filter,
      headersReceivedExtraInfoSpec(webRequest),
    );
  } catch (error) {
    rgWarn(SCOPE, 'webRequest extraHeaders rejected — retrying', error);
    try {
      webRequest.onHeadersReceived.addListener(listener, filter, [
        'responseHeaders',
      ]);
    } catch (retry) {
      throw retry;
    }
  }
}

let lastBridgesError: string | null = null;

export function embedBridgesError(): string | null {
  return lastBridgesError;
}

/** Tab login and iframe Set-Cookie both land in CtrlEm's embed cookie jar. */
export function installEmbedSessionBridges(): void {
  lastBridgesError = null;
  try {
    for (const domain of EMBED_COOKIE_DOMAINS) {
      installUnpartitionedCookieMirror(domain);
    }
    installIframeSetCookieBridge();
  } catch (error) {
    lastBridgesError = errorMessage(error);
    rgWarn(SCOPE, 'embed session bridges failed', error);
  }
}

