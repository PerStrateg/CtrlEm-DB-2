import { directMediaUrl, mediaKindFromUrl, mediaResource } from '../domain/media-resource';
import type { MediaSourcePort, MediaTarget } from '../ports/media-source-port';

function elementUrl(element: HTMLImageElement | HTMLVideoElement, kind: 'image' | 'video'): URL | undefined {
  const document = element.ownerDocument;
  if (kind === 'image') {
    const linked = element.closest<HTMLAnchorElement>('a[href]');
    const original = linked && directMediaUrl(linked.href, document.baseURI);
    if (original && mediaKindFromUrl(original) === 'image') return original;
  }
  const sources = element instanceof document.defaultView!.HTMLVideoElement
    ? Array.from(element.querySelectorAll('source'), source => source.src)
    : [];
  return [element.currentSrc, element.src, ...sources].map(value => directMediaUrl(value, document.baseURI)).find(Boolean);
}

/** Resolves direct page media without knowing site markup. */
export class HtmlMediaSource implements MediaSourcePort {
  resolve(origin: Element): MediaTarget | undefined {
    const element = origin.closest<HTMLElement>('img, video, a[href]');
    if (!element) return undefined;
    const window = element.ownerDocument.defaultView!;
    if (element instanceof window.HTMLImageElement) {
      const url = elementUrl(element, 'image');
      return url ? { resource: mediaResource('image', url), element } : undefined;
    }
    if (element instanceof window.HTMLVideoElement) {
      const url = elementUrl(element, 'video');
      return url ? { resource: mediaResource('video', url), element } : undefined;
    }
    const url = directMediaUrl((element as HTMLAnchorElement).href, element.ownerDocument.baseURI);
    const kind = url && mediaKindFromUrl(url);
    return url && kind ? { resource: mediaResource(kind, url), element } : undefined;
  }
}
