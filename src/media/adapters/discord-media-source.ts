import { directMediaUrl, mediaKindFromUrl, mediaResource } from '../domain/media-resource';
import type { MediaAttachmentSourcePort, OwnedMediaTarget } from '../ports/media-source-port';

const attachmentsSelector = '[id^="message-accessories-"]';
const attachmentSelector = 'a[data-role="img"][href], video, a[href]';

function attachmentUrl(element: HTMLElement): URL | undefined {
  const document = element.ownerDocument;
  if (element instanceof document.defaultView!.HTMLVideoElement) return directMediaUrl(element.currentSrc || element.src, document.baseURI);
  return directMediaUrl((element as HTMLAnchorElement).href, document.baseURI);
}

function attachmentKind(element: HTMLElement, url: URL): 'image' | 'video' | undefined {
  if (element instanceof element.ownerDocument.defaultView!.HTMLVideoElement) return 'video';
  return mediaKindFromUrl(url);
}

function attachmentFrame(element: HTMLElement, root: Element): HTMLElement {
  return element.parentElement === root ? element : element.parentElement ?? element;
}

/** Discord prefers original attachment links and keeps one action bar per message attachment. */
export class DiscordMediaSource implements MediaAttachmentSourcePort {
  appliesTo(document: Document): boolean { return document.location.hostname === 'discord.com'; }

  roots(document: Document): HTMLElement[] { return Array.from(document.querySelectorAll<HTMLElement>(attachmentsSelector)); }

  rootsFor(records: MutationRecord[]): HTMLElement[] {
    const roots = new Set<HTMLElement>();
    for (const record of records) {
      const view = record.target.ownerDocument!.defaultView!;
      if (record.target instanceof view.Element) {
        const host = record.target.closest<HTMLElement>(attachmentsSelector);
        if (host) roots.add(host);
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof view.Element)) continue;
        const root = node.closest<HTMLElement>(attachmentsSelector);
        if (root) roots.add(root);
        for (const descendant of node.querySelectorAll<HTMLElement>(attachmentsSelector)) roots.add(descendant);
      }
    }
    return [...roots];
  }

  targetsIn(root: Element): OwnedMediaTarget[] {
    const targets = new Map<string, OwnedMediaTarget>();
    for (const element of root.querySelectorAll<HTMLElement>(attachmentSelector)) {
      const url = attachmentUrl(element);
      if (!url) continue;
      const kind = attachmentKind(element, url);
      if (!kind) continue;
      const resource = mediaResource(kind, url);
      if (targets.has(resource.id) && !element.matches('a[data-role="img"], video')) continue;
      targets.set(resource.id, { key: `${root.id}\u0000${resource.id}`, resource, element: attachmentFrame(element, root) });
    }
    return [...targets.values()];
  }

  resolve(origin: Element): OwnedMediaTarget | undefined {
    const root = origin.closest<HTMLElement>(attachmentsSelector);
    if (!root) return undefined;
    return this.targetsIn(root).find(target => target.element.contains(origin));
  }
}
