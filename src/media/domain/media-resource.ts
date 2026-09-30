export type MediaKind = 'image' | 'video';
export type MediaAction = 'popup-image' | 'wallpaper' | 'video-overlay';

export interface MediaResource {
  id: string;
  kind: MediaKind;
  url: string;
}

export interface MediaTarget {
  resource: MediaResource;
  element: HTMLElement;
}

export interface MediaSendIntent {
  resource: MediaResource;
  action: MediaAction;
}

export function mediaActions(kind: MediaKind): MediaAction[] {
  return kind === 'image' ? ['popup-image', 'wallpaper'] : ['video-overlay'];
}

const extensions: Record<MediaKind, RegExp> = {
  image: /\.(?:avif|bmp|gif|jpe?g|png|tiff?|webp)$/i,
  video: /\.(?:mov|mp4|webm)$/i,
};

export function directMediaUrl(value: string, baseUrl: string): URL | undefined {
  if (!value.trim()) return undefined;
  try {
    const url = new URL(value, baseUrl);
    return ['http:', 'https:'].includes(url.protocol) ? url : undefined;
  } catch { return undefined; }
}

export function mediaKindFromUrl(url: URL): MediaKind | undefined {
  return (Object.entries(extensions) as [MediaKind, RegExp][]).find(([, extension]) => extension.test(url.pathname))?.[0];
}

/** Full href is the identity: query carries distinct files, so ids must not stop at the pathname. */
export function mediaResourceId(kind: MediaKind, href: string): string {
  return `${kind}:${href}`;
}

export function mediaResource(kind: MediaKind, url: URL): MediaResource {
  return { id: mediaResourceId(kind, url.href), kind, url: url.href };
}
