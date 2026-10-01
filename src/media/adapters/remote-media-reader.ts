import { mediaLabelCharacters } from '../../shared/media-library-protocol';
import type { MediaKind } from '../domain/media-resource';

const downloadTimeoutMs = 60_000;
const htmlMimeType = 'text/html';
const mediaExtensions = /\.(?:avif|bmp|gif|jpe?g|png|tiff?|webp|mov|mp4|webm)$/i;
const imageExtensionsByMime: Record<string, string> =
  { 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/tiff': 'tiff' };
const videoExtensionsByMime: Record<string, string> = { 'video/quicktime': 'mov', 'video/webm': 'webm' };
const fallbackBaseName = 'media';

export interface RemoteMediaSource { url: string; kind: MediaKind }
export interface DownloadProgress { stage: 'download'; loaded?: number; total?: number }

/** Streams a remote file into bounded memory: the byte cap and the request timeout hold during transfer. */
export async function downloadRemoteMediaFile(source: RemoteMediaSource, request: typeof fetch, signal: AbortSignal,
  progress: (value: DownloadProgress) => void, limitBytes: number, timeoutMs = downloadTimeoutMs): Promise<File> {
  const response = await request(source.url,
    { credentials: 'omit', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) });
  if (!response.ok || !isHttpResponse(response, source.url)) throw new Error('download');
  const mimeType = mediaContentType(response);
  if (mimeType === htmlMimeType) { await response.body?.cancel(); throw new Error('html'); }
  progress({ stage: 'download' });
  const declared = Number(response.headers.get('content-length'));
  if (declared > limitBytes) { await response.body?.cancel(); throw new Error('size'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('download');
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try { while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > limitBytes) { await reader.cancel(); throw new Error('size'); }
    parts.push(chunk.value);
    progress({ stage: 'download', loaded: size, ...(declared ? { total: declared } : {}) });
  } } finally { reader.releaseLock(); }
  return new File(parts, mediaFileName(source, mimeType), { type: mimeType });
}

function isHttpResponse(response: Response, requestedUrl: string): boolean {
  return ['http:', 'https:'].includes(new URL(response.url || requestedUrl).protocol);
}

function mediaContentType(response: Response): string {
  return response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
}

function mediaFileName(source: RemoteMediaSource, mimeType: string): string {
  const raw = pathName(source.url);
  const named = mediaExtensions.test(raw) ? raw : `${raw || fallbackBaseName}.${mediaExtension(source.kind, mimeType)}`;
  return named.slice(-mediaLabelCharacters);
}

function pathName(url: string): string {
  let name = new URL(url).pathname.split('/').pop() ?? '';
  try { name = decodeURIComponent(name); } catch { /* A valid URL may contain a literal percent sign. */ }
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-mediaLabelCharacters);
}

function mediaExtension(kind: MediaKind, mimeType: string): string {
  return (kind === 'video' ? videoExtensionsByMime : imageExtensionsByMime)[mimeType] ?? (kind === 'video' ? 'mp4' : 'png');
}
