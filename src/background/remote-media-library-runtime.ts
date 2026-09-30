import { mediaCategoriesRequestSchema, mediaLabelCharacters, remoteMediaSaveSchema, remoteMediaUploadPort } from '../shared/media-library-protocol';
import type { LibraryRepository, WriteQueue } from '../storage/library-store';
import { notifyLibraryChanged } from './library-events';
export { notifyLibraryChanged } from './library-events';
import type { CredentialsRepository } from '../storage/credentials-store';
import { providerForType, providers, uploadFile, uploadFileError } from '../upload/providers';
import type { ProviderId } from '../upload/providers';
import type { Credentials } from '../shared/credentials-protocol';
import type { MediaKind } from '../media/domain/media-resource';

const downloadTimeoutMs = 60_000;

export function registerRemoteMediaLibrary(library: LibraryRepository, queue: WriteQueue,
  credentials: CredentialsRepository, request: typeof fetch): void {
  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    if ((input as { type?: string })?.type !== 'media-library:categories') return false;
    const parsed = mediaCategoriesRequestSchema.safeParse(input);
    if (!parsed.success || !webSender(sender)) { respond({ ok: false, error: 'Request not allowed.' }); return false; }
    void library.read().then(value => respond({ ok: true, value: value.categories.filter(category => category.type === parsed.data.kind).map(({ id, name }) => ({ id, name })) }),
      () => respond({ ok: false, error: 'Couldn’t load categories.' })); return true;
  });
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== remoteMediaUploadPort || !webSender(port.sender)) return;
    const abort = new AbortController(); let started = false; let connected = true;
    // A closed tab ends the channel; it never becomes a rejected postMessage.
    const post = (message: object) => {
      if (!connected) return;
      try { port.postMessage(message); } catch { connected = false; abort.abort(); }
    };
    port.onDisconnect.addListener(() => { connected = false; abort.abort(); });
    port.onMessage.addListener(input => {
      if (started) return; started = true;
      void save(input, library, queue, credentials, request, abort.signal, post)
        .then(() => post({ type: 'result', ok: true }),
          error => post({ type: 'result', ok: false, error: publicError(error) }));
    });
  });
}

async function save(input: unknown, library: LibraryRepository, queue: WriteQueue, credentials: CredentialsRepository,
  request: typeof fetch, signal: AbortSignal, post: (message: object) => void): Promise<void> {
  const { resource, categoryId, uploadedUrl, uploadedLabel } = remoteMediaSaveSchema.parse(input);
  const provider = providerForType[resource.kind];
  const progress = (value: object) => post({ type: 'progress', value });
  const file = uploadedUrl ? undefined : await downloadRemoteMedia(resource, request, signal, progress, providers[provider].maxBytes);
  if (file) { const invalid = uploadFileError(provider, resource.kind, file); if (invalid) throw new Error(invalid); }
  const keys: Credentials = { imgbb: resource.kind === 'image' ? await credentials.readField('imgbb') : '', catbox: '' };
  // The external upload is published before the library write, so a later retry resumes from it.
  const url = uploadedUrl ?? await externalUpload(provider, file!, keys, signal, request, progress);
  const label = file?.name ?? uploadedLabel ?? '';
  post({ type: 'uploaded', value: url, label });
  const result = await queue.run(() => library.addUpload(resource.kind, { categoryId, value: url, label }));
  if (result.status !== 'saved') throw new Error('category');
  await notifyLibraryChanged(result.library);
}

async function externalUpload(provider: ProviderId, file: File, keys: Credentials, signal: AbortSignal,
  request: typeof fetch, post: (message: object) => void): Promise<string> {
  post({ stage: 'upload' }); return uploadFile(provider, file, keys, signal, request);
}

export async function downloadRemoteMedia(resource: { url: string; kind: MediaKind }, request: typeof fetch,
  signal: AbortSignal, progress: (value: object) => void, limit = providers[providerForType[resource.kind]].maxBytes): Promise<File> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(downloadTimeoutMs)]);
  progress({ stage: 'download' });
  const response = await request(resource.url, { credentials: 'omit', cache: 'no-store', signal });
  if (!response.ok || !['http:', 'https:'].includes(new URL(response.url || resource.url).protocol)) throw new Error('download');
  const declared = Number(response.headers.get('content-length')); if (declared > limit) throw new Error('size');
  const reader = response.body?.getReader(); if (!reader) throw new Error('download');
  const parts: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > limit) { await reader.cancel(); throw new Error('size'); } parts.push(chunk.value); progress({ stage: 'download', loaded: size, ...(declared ? { total: declared } : {}) }); }
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''; const name = fileName(resource.url, resource.kind, mime);
  return new File(parts, name, { type: mime });
}

function fileName(source: string, kind: MediaKind, mime: string): string {
  let name = new URL(source).pathname.split('/').pop() || 'media';
  try { name = decodeURIComponent(name); } catch { /* A valid URL may contain a literal percent sign. */ }
  const raw = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-mediaLabelCharacters);
  if (/\.(?:avif|bmp|gif|jpe?g|png|tiff?|webp|mov|mp4|webm)$/i.test(raw)) return raw;
  const extension = kind === 'image' ? ({ 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/tiff': 'tiff' }[mime] ?? 'png')
    : mime === 'video/quicktime' ? 'mov' : mime === 'video/webm' ? 'webm' : 'mp4';
  return `${raw || 'media'}.${extension}`.slice(-mediaLabelCharacters);
}
function webSender(sender?: chrome.runtime.MessageSender): boolean { try { return sender?.id === chrome.runtime.id && sender.tab?.id !== undefined && ['http:', 'https:'].includes(new URL(sender.url!).protocol); } catch { return false; } }
function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'size') return 'This media is too large.';
  if (message === 'category') return 'Choose an existing category.';
  if (message === 'download') return 'Couldn’t read this file from the site. Use a direct link to the file.';
  return message.startsWith('Choose a ') ? message : 'Couldn’t save this media. Retry.';
}
