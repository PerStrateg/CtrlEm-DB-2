import { directMediaUrl, mediaKindFromUrl, mediaResource, type MediaTarget } from '../domain/media-resource';

const accessoriesSelector = '[id^="message-accessories-"]';

function candidates(accessories: Element): HTMLElement[] {
  return Array.from(accessories.querySelectorAll<HTMLElement>('a[data-role="img"][href], video, a[href]'));
}

function candidateUrl(element: HTMLElement): URL | undefined {
  const document = element.ownerDocument;
  if (element instanceof document.defaultView!.HTMLVideoElement) {
    return [element.currentSrc, element.src].map(value => directMediaUrl(value, document.baseURI)).find(Boolean);
  }
  return directMediaUrl((element as HTMLAnchorElement).href, document.baseURI);
}

function attachmentFrame(element: HTMLElement, accessories: Element): HTMLElement {
  return element.parentElement === accessories ? element : element.parentElement ?? element;
}

/** Discord adapter prefers original attachment links and groups duplicate filename/download anchors. */
export class DiscordMediaSource {
  matches(document: Document): boolean { return document.location.hostname === 'discord.com'; }

  scan(document: Document): MediaTarget[] {
    const targets = new Map<string, MediaTarget>();
    for (const accessories of document.querySelectorAll(accessoriesSelector)) {
      const media = candidates(accessories);
      for (const element of media) {
        const url = candidateUrl(element);
        if (!url) continue;
        const kind = element instanceof document.defaultView!.HTMLVideoElement ? 'video' : mediaKindFromUrl(url);
        if (!kind) continue;
        const resource = mediaResource(kind, url);
        const current = targets.get(resource.id);
        const preferred = element.matches('a[data-role="img"], video');
        if (!current || preferred) targets.set(resource.id, { resource, element: attachmentFrame(element, accessories) });
      }
    }
    return [...targets.values()];
  }
}
