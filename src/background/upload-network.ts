import { UploadError, type UploadNetworkDiagnostic } from '../shared/upload-errors';
import { providers } from '../upload/providers';

type RequestIdentity = { requestId: string; url: string; method: string; initiator?: string; originUrl?: string };

/** Observe only our Catbox POST. Never request headers, bodies, cookies or redirect URLs. */
export function diagnosticUploadFetch(api: typeof chrome.webRequest, extensionRoot: string,
  request: typeof fetch = fetch, permissions?: Pick<typeof chrome.permissions, 'contains'>): typeof fetch {
  const active = new Set<{ ambiguous: boolean }>();
  return async (input, options) => {
    if (input !== providers.catbox.endpoint || options?.method !== 'POST') return request(input, options);
    const operation = { ambiguous: active.size > 0 };
    for (const other of active) other.ambiguous = true;
    active.add(operation);
    const records = new Map<string, UploadNetworkDiagnostic>();
    let originMissing = false;
    const root = extensionRoot.replace(/\/$/, '');
    const before = (event: RequestIdentity): undefined => {
      const origin = event.originUrl ?? event.initiator;
      if (event.url === providers.catbox.endpoint && event.method === 'POST' && !origin) originMissing = true;
      if (event.url === providers.catbox.endpoint && event.method === 'POST' &&
        (origin === root || origin?.startsWith(`${root}/`))) {
        records.set(event.requestId, { observation: 'observed' });
      }
    };
    const headers = (event: { requestId: string; statusCode: number }): undefined => {
      const record = records.get(event.requestId);
      if (record) record.status = event.statusCode;
    };
    const redirect = (event: { requestId: string; statusCode: number }) => {
      headers(event);
      const record = records.get(event.requestId);
      if (record) record.redirected = true;
    };
    const failed = (event: { requestId: string; error: string }) => {
      const record = records.get(event.requestId);
      // Browser-defined symbolic codes only; never arbitrary exception text.
      if (record && /^(?:NS_ERROR_[A-Z0-9_]+|net::ERR_[A-Z0-9_]+)$/.test(event.error)) record.browserError = event.error;
    };
    const filter = { urls: [providers.catbox.endpoint] };
    let available = false;
    try {
      api.onBeforeRequest.addListener(before, filter);
      api.onHeadersReceived.addListener(headers, filter);
      api.onBeforeRedirect.addListener(redirect, filter);
      api.onErrorOccurred.addListener(failed, filter);
      available = true;
    } catch { /* A failed observer must not change the upload or trigger another request. */ }
    try {
      const response = await request(input, options);
      if (!response.ok) throw new UploadError({ stage: 'upload', code: 'http', status: response.status });
      return response;
    } catch (error) {
      const network: UploadNetworkDiagnostic = !available ? { observation: 'unavailable' }
        : operation.ambiguous || records.size > 1 ? { observation: 'ambiguous' }
        : records.values().next().value ?? { observation: 'not-observed' };
      if (permissions) {
        const queries = await Promise.allSettled([
          permissions.contains({ origins: [`${new URL(providers.catbox.endpoint).origin}/*`] }),
          permissions.contains({ permissions: ['webRequest'] }),
        ]);
        const result = (value: PromiseSettledResult<boolean>) => value.status === 'fulfilled'
          ? value.value ? 'granted' as const : 'missing' as const : 'unknown' as const;
        network.hostPermission = result(queries[0]!);
        network.observerPermission = result(queries[1]!);
      }
      if (originMissing) network.originMissing = true;
      throw new UploadError({ ...(error instanceof UploadError ? error.failure : { stage: 'upload', code: 'network' } as const), network });
    } finally {
      api?.onBeforeRequest.removeListener(before);
      api?.onHeadersReceived.removeListener(headers);
      api?.onBeforeRedirect.removeListener(redirect);
      api?.onErrorOccurred.removeListener(failed);
      active.delete(operation);
    }
  };
}
