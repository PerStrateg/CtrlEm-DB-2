import { directMediaUrl, mediaKindFromUrl, mediaResource } from '../domain/media-resource';
import type { MediaSourcePort, MediaTarget } from '../ports/media-source-port';

function imageUrl(element: HTMLImageElement): URL | undefined {
  const document = element.ownerDocument;
  // currentSrc is what the page actually shows; the wrapper link can point at an HTML page named like a file.
  const shown = directMediaUrl(element.currentSrc || element.src, document.baseURI);
  return shown && mediaKindFromUrl(shown) ? shown : undefined;
}

function videoUrl(element: HTMLVideoElement): URL | undefined {
  const candidates = [element.currentSrc, element.src, ...Array.from(element.querySelectorAll('source'), source => source.src)];
  return candidates.map(value => directMediaUrl(value, element.ownerDocument.baseURI)).find(Boolean);
}

/** Resolves direct page media without knowing site markup. */
export class HtmlMediaSource implements MediaSourcePort {
  resolve(origin: Element): MediaTarget | undefined {
    const element = origin.closest<HTMLElement>('img, video, a[href]');
    if (!element) return undefined;
    const window = element.ownerDocument.defaultView!;
    if (element instanceof window.HTMLImageElement) {
      const url = imageUrl(element);
      return url ? { resource: mediaResource('image', url), element } : undefined;
    }
    if (element instanceof window.HTMLVideoElement) {
      const url = videoUrl(element);
      return url ? { resource: mediaResource('video', url), element } : undefined;
    }
    const url = directMediaUrl((element as HTMLAnchorElement).href, element.ownerDocument.baseURI);
    const kind = url && mediaKindFromUrl(url);
    return url && kind ? { resource: mediaResource(kind, url), element } : undefined;
  }
}
