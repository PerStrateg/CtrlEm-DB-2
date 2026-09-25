import type { Credentials } from '../shared/credentials-protocol';

export type UploadType = 'image' | 'sound' | 'video';
export type ProviderId = 'imgbb' | 'catbox';
// Verified against api.imgbb.com, catbox.moe/tools.php and catbox.moe on 2026-09-25.
export const providers = {
  imgbb: { label: 'ImgBB', types: ['image'], maxBytes: 32 * 1024 * 1024, endpoint: 'https://api.imgbb.com/1/upload', requiredKey: true },
  catbox: { label: 'Catbox', types: ['sound', 'video'], maxBytes: 200 * 1024 * 1024, endpoint: 'https://catbox.moe/user/api.php', requiredKey: false },
} satisfies Record<ProviderId, { label: string; types: UploadType[]; maxBytes: number; endpoint: string; requiredKey: boolean }>;

export interface UploadFile { name: string; size: number; type: string }
export function uploadFileError(provider: ProviderId, type: UploadType, file: UploadFile): string | undefined {
  const config = providers[provider];
  if (!(config.types as readonly string[]).includes(type)) return 'Choose a provider for this media type.';
  if (file.size > config.maxBytes) return `Choose a file up to ${config.maxBytes / 1024 / 1024} MB.`;
  const media = type === 'sound' ? 'audio' : type;
  // Browsers may report an empty MIME type for local media; use its extension then.
  const extensions = { image: /\.(png|jpe?g|gif|webp|bmp|avif|tiff?)$/i, sound: /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i, video: /\.(mp4|webm|mov|m4v|mkv|avi)$/i };
  if (file.type ? !file.type.startsWith(`${media}/`) : !extensions[type].test(file.name)) return `Choose a ${type} file.`;
}

export async function uploadFile(provider: ProviderId, file: File, credentials: Credentials,
  signal: AbortSignal, request: typeof fetch = fetch): Promise<string> {
  const body = new FormData();
  if (provider === 'imgbb') {
    if (!credentials.imgbb) throw new Error('Set up ImgBB before uploading.');
    body.set('key', credentials.imgbb);
    body.set('image', file);
  } else {
    body.set('reqtype', 'fileupload');
    if (credentials.catbox) body.set('userhash', credentials.catbox);
    body.set('fileToUpload', file);
  }
  const response = await request(providers[provider].endpoint, { method: 'POST', body, signal, credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error('Upload failed.');
  const value: unknown = provider === 'catbox' ? (await response.text()).trim() : (await response.json()).data?.url;
  // Never forward a provider error body (which could include a credential) as a URL.
  if (typeof value !== 'string') throw new Error('Provider did not return a link.');
  const url = new URL(value);
  const host = provider === 'catbox' ? 'files.catbox.moe' : 'i.ibb.co';
  if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password) throw new Error('Provider did not return a direct link.');
  return url.href;
}
