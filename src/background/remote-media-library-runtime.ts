import { mediaCategoriesRequestSchema, remoteMediaSaveSchema, remoteMediaUploadPort } from '../shared/media-library-protocol';
import type { LibraryRepository, WriteQueue } from '../storage/library-store';
import type { CredentialsRepository } from '../storage/credentials-store';
import { providerForType, providers, uploadFile, uploadFileError } from '../upload/providers';
import type { MediaKind } from '../media/domain/media-resource';

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
    const abort = new AbortController(); let started = false;
    port.onMessage.addListener(input => {
      if (started) return; started = true;
      void save(input, library, queue, credentials, request, abort.signal, value => port.postMessage({ type: 'progress', value }))
        .then(() => port.postMessage({ type: 'result', ok: true }), error => port.postMessage({ type: 'result', ok: false, error: publicError(error) }));
    });
    port.onDisconnect.addListener(() => abort.abort());
  });
}

async function save(input: unknown, library: LibraryRepository, queue: WriteQueue, credentials: CredentialsRepository,
  request: typeof fetch, signal: AbortSignal, progress: (value: object) => void): Promise<void> {
  const { resource, categoryId } = remoteMediaSaveSchema.parse(input); const provider = providerForType[resource.kind]; const limit = providers[provider].maxBytes;
  progress({ stage: 'download' });
  const response = await request(resource.url, { credentials: 'omit', cache: 'no-store', signal });
  if (!response.ok || !['http:', 'https:'].includes(new URL(response.url || resource.url).protocol)) throw new Error('download');
  const declared = Number(response.headers.get('content-length')); if (declared > limit) throw new Error('size');
  const reader = response.body?.getReader(); if (!reader) throw new Error('download');
  const parts: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > limit) { await reader.cancel(); throw new Error('size'); } parts.push(chunk.value); progress({ stage: 'download', loaded: size, ...(declared ? { total: declared } : {}) }); }
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''; const name = fileName(resource.url, resource.kind, mime);
  const file = new File(parts, name, { type: mime }); const invalid = uploadFileError(provider, resource.kind, file); if (invalid) throw new Error(invalid);
  const keys = { imgbb: resource.kind === 'image' ? await credentials.readField('imgbb') : '', catbox: '' };
  progress({ stage: 'upload' }); const url = await uploadFile(provider, file, keys, signal, request);
  progress({ stage: 'save' }); const result = await queue.run(() => library.addUpload(resource.kind, { categoryId, value: url, label: name }));
  if (result.status !== 'saved') throw new Error('category');
}

function fileName(source: string, kind: MediaKind, mime: string): string {
  const raw = decodeURIComponent(new URL(source).pathname.split('/').pop() || 'media').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
  if (/\.(?:avif|bmp|gif|jpe?g|png|tiff?|webp|mov|mp4|webm)$/i.test(raw)) return raw;
  const extension = kind === 'image' ? ({ 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif' }[mime] ?? 'png')
    : mime === 'video/quicktime' ? 'mov' : mime === 'video/webm' ? 'webm' : 'mp4';
  return `${raw || 'media'}.${extension}`;
}
function webSender(sender?: chrome.runtime.MessageSender): boolean { try { return sender?.id === chrome.runtime.id && sender.tab?.id !== undefined && ['http:', 'https:'].includes(new URL(sender.url!).protocol); } catch { return false; } }
function publicError(error: unknown): string { const message = error instanceof Error ? error.message : ''; return message === 'size' ? 'This media is too large.' : message === 'category' ? 'Choose an existing category.' : message.startsWith('Choose a ') ? message : 'Couldn’t save this media. Retry.'; }
