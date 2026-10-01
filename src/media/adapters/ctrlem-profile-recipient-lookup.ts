import { recipientProfileLimits, profileUrl } from '../domain/recipient-profile';

export async function fetchProfileHtml(code: string, request: typeof fetch): Promise<string> {
  const signal = AbortSignal.timeout(recipientProfileLimits.timeoutMs);
  const response = await request(profileUrl(code), {
    credentials: 'include', cache: 'no-store', redirect: 'follow', signal,
  });
  if (response.status === 404) return '';
  if (response.status !== 200) throw new Error(`CtrlEm profile unavailable: ${response.status}`);
  if (new URL(response.url).origin !== 'https://ctrlem.com') throw new Error('CtrlEm profile origin mismatch.');
  if (new URL(response.url).pathname.toLowerCase() !== `/u/${encodeURIComponent(code)}`.toLowerCase()) {
    throw new Error('CtrlEm profile path mismatch.');
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) throw new Error('CtrlEm profile is not HTML.');
  return readBoundedText(response, recipientProfileLimits.maxBytes);
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) throw new Error('CtrlEm profile is empty.');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '', size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('CtrlEm profile is too large.'); }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}
