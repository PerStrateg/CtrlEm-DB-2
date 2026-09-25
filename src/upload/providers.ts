import { UploadError } from '../shared/upload-errors';
import type { Credentials } from '../shared/credentials-protocol';

export type UploadType = 'image' | 'sound' | 'video';
export type ProviderId = 'imgbb' | 'catbox' | 'vidhosting';
export const providerForType: Record<UploadType, ProviderId> = { image: 'imgbb', sound: 'catbox', video: 'vidhosting' };
// Verified against api.imgbb.com, catbox.moe/tools.php and catbox.moe on 2026-09-25.
export const providers = {
  imgbb: { label: 'ImgBB', types: ['image'], maxBytes: 32 * 1024 * 1024, endpoint: 'https://api.imgbb.com/1/upload', requiredKey: false },
  catbox: { label: 'Catbox', types: ['sound'], maxBytes: 200 * 1024 * 1024, endpoint: 'https://catbox.moe/user/api.php', requiredKey: false },
  vidhosting: { label: 'VidHosting', types: ['video'], maxBytes: 100 * 1024 * 1024, endpoint: 'https://upload.vidhosting.in/', requiredKey: false },
} satisfies Record<ProviderId, { label: string; types: UploadType[]; maxBytes: number; endpoint: string; requiredKey: boolean }>;

export const imgbbAnonymous = { page: 'https://imgbb.com/', endpoint: 'https://imgbb.com/json' };

export const uploadFormats = {
  image: { accept: '.jpg,.jpeg,.png,.gif,.webp,.bmp,.avif,.tif,.tiff', hint: 'JPG, PNG, GIF, WebP, BMP, AVIF, TIFF', extension: /\.(png|jpe?g|gif|webp|bmp|avif|tiff?)$/i, media: 'image' },
  sound: { accept: '.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus,.webm', hint: 'MP3, WAV, OGG, M4A, AAC, FLAC, Opus, WebM', extension: /\.(mp3|wav|ogg|m4a|aac|flac|opus|webm)$/i, media: 'audio' },
  video: { accept: '.mp4,.webm,.mov', hint: 'MP4, WebM, MOV', extension: /\.(mp4|webm|mov)$/i, media: 'video' },
};

export interface UploadFile { name: string; size: number; type: string }
export function uploadFileError(provider: ProviderId, type: UploadType, file: UploadFile): string | undefined {
  const config = providers[provider];
  if (providerForType[type] !== provider) return 'Choose a provider for this media type.';
  if (file.size > config.maxBytes) return `Choose a file up to ${config.maxBytes / 1024 / 1024} MB.`;
  const format = uploadFormats[type];
  if (!format.extension.test(file.name) || (file.type && !file.type.startsWith(`${format.media}/`))) return `Choose a ${type} file: ${format.hint}.`;
}

export async function uploadFile(provider: ProviderId, file: File, credentials: Credentials,
  signal: AbortSignal, request: typeof fetch = fetch): Promise<string> {
  const body = new FormData();
  const anonymous = provider === 'imgbb' && !credentials.imgbb;
  if (anonymous) {
    let page: Response;
    try { page = await request(imgbbAnonymous.page, { credentials: 'omit', redirect: 'error', signal }); }
    catch { throw new UploadError({ stage: 'page', code: 'network', anonymous: true }); }
    if (!page.ok) throw new UploadError({ stage: 'page', code: 'http', status: page.status, anonymous: true });
    const token = /PF\.obj\.config\.auth_token\s*=\s*["']([a-zA-Z0-9]+)["']/.exec(await page.text())?.[1];
    if (!token) throw new UploadError({ stage: 'token', code: 'unavailable', anonymous: true });
    body.set('source', file);
    body.set('type', 'file');
    body.set('action', 'upload');
    body.set('timestamp', String(Date.now()));
    body.set('auth_token', token);
  } else if (provider === 'imgbb') {
    body.set('key', credentials.imgbb);
    body.set('image', file);
  } else if (provider === 'catbox') {
    body.set('reqtype', 'fileupload');
    if (credentials.catbox) body.set('userhash', credentials.catbox);
    body.set('fileToUpload', file);
  } else {
    body.set('file', file);
  }
  let response: Response;
  try { response = await request(anonymous ? imgbbAnonymous.endpoint : providers[provider].endpoint, { method: 'POST', body, signal, credentials: 'omit', redirect: 'error' }); }
  catch { throw new UploadError({ stage: 'upload', code: 'network', anonymous }); }
  if (!response.ok) throw new UploadError({ stage: 'upload', code: 'http', status: response.status, anonymous });
  try {
    let value: unknown;
    if (provider === 'catbox') value = (await response.text()).trim();
    else {
      const result = await response.json();
      if (provider === 'vidhosting' && result.success !== true) throw new Error('Upload failed.');
      if (anonymous && result.status_code !== 200) throw new Error('ImgBB anonymous upload failed.');
      value = provider === 'imgbb' ? (anonymous ? result.image?.url : result.data?.url) : result.url;
    }
    // Never forward a provider error body (which could include a credential) as a URL.
    if (typeof value !== 'string') throw new Error('Provider did not return a link.');
    const url = new URL(value);
    const host = { catbox: 'files.catbox.moe', imgbb: 'i.ibb.co', vidhosting: 'stream.vidhosting.in' }[provider];
    if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password) throw new Error('Provider did not return a direct link.');
    if (provider === 'vidhosting' && !url.pathname.startsWith('/videos/')) url.pathname = `/videos${url.pathname}`;
    return url.href;
  } catch { throw new UploadError({ stage: 'response', code: 'invalid-response', anonymous }); }
}
