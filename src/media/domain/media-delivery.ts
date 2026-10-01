import type { MediaKind } from './media-resource';

const discordMediaHosts = new Set(['cdn.discordapp.com', 'media.discordapp.net', 'cdn.discordapp.net']);
const redgifsHostSuffix = '.redgifs.com';
const redgifsSiteHosts = new Set(['redgifs.com', 'www.redgifs.com']);
const ctrlemUploadPath = '/api/uploads/';
const ctrlemHost = 'ctrlem.com';

export type ImageDelivery = 'direct' | 'upload';

/**
 * Image delivery by origin: only hosts that serve the bytes themselves can be linked.
 * Video stays direct because CtrlEm transfers it from the page, never re-uploads it.
 */
export function imageDelivery(kind: MediaKind, url: URL): ImageDelivery {
  if (kind === 'video') return 'direct';
  if (discordMediaHosts.has(url.hostname) || isRedgifsMediaHost(url.hostname) || isCtrlemUpload(url)) return 'direct';
  return 'upload';
}

function isRedgifsMediaHost(hostname: string): boolean {
  return hostname.endsWith(redgifsHostSuffix) && !redgifsSiteHosts.has(hostname);
}

function isCtrlemUpload(url: URL): boolean {
  return url.hostname === ctrlemHost && url.pathname.startsWith(ctrlemUploadPath);
}
