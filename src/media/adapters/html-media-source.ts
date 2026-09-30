import { directMediaUrl, mediaKindFromUrl, mediaResource, type MediaKind, type MediaTarget } from '../domain/media-resource';

function elementUrl(element: HTMLImageElement | HTMLVideoElement, kind: MediaKind): URL | undefined {
  const document = element.ownerDocument;
  if (kind === 'image') {
    const linked = element.closest<HTMLAnchorElement>('a[href]');
    const original = linked && directMediaUrl(linked.href, document.baseURI);
    if (original && mediaKindFromUrl(original) === 'image') return original;
  }
  const values = element instanceof document.defaultView!.HTMLVideoElement
    ? [element.currentSrc, element.src, ...Array.from(element.querySelectorAll('source')).map(source => source.src)]
    : [element.currentSrc, element.src];
  return values.map(value => directMediaUrl(value, document.baseURI)).find(Boolean);
}

/** Resolves direct page media without knowing site markup. */
export class HtmlMediaSource {
  resolve(origin: Element): MediaTarget | undefined {
    const element = origin.closest<HTMLElement>('img, video, a[href]');
    if (!element) return undefined;
    if (element instanceof element.ownerDocument.defaultView!.HTMLImageElement) {
      const url = elementUrl(element, 'image');
      return url ? { resource: mediaResource('image', url), element } : undefined;
    }
    if (element instanceof element.ownerDocument.defaultView!.HTMLVideoElement) {
      const url = elementUrl(element, 'video');
      return url ? { resource: mediaResource('video', url), element } : undefined;
    }
    const url = directMediaUrl((element as HTMLAnchorElement).href, element.ownerDocument.baseURI);
    const kind = url && mediaKindFromUrl(url);
    return url && kind ? { resource: mediaResource(kind, url), element } : undefined;
  }
}
