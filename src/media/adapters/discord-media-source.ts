import { directMediaUrl, mediaKindFromUrl, mediaResource } from '../domain/media-resource';
import type { MediaAttachmentSourcePort, OwnedMediaTarget } from '../ports/media-source-port';

const attachmentsSelector = '[id^="message-accessories-"]';
const attachmentSelector = 'a[data-role="img"][href], video, a[href]';

function videoAttachmentUrl(element: HTMLVideoElement): URL | undefined {
  const document = element.ownerDocument;
  const candidates = [element.currentSrc, element.src, ...Array.from(element.querySelectorAll('source'), source => source.src)];
  return candidates.map(value => directMediaUrl(value, document.baseURI)).find(Boolean);
}

function attachmentUrl(element: HTMLElement): URL | undefined {
  const document = element.ownerDocument;
  if (element instanceof document.defaultView!.HTMLVideoElement) return videoAttachmentUrl(element);
  return directMediaUrl((element as HTMLAnchorElement).href, document.baseURI);
}

function isDownloadAnchor(element: HTMLElement): boolean {
  return element instanceof element.ownerDocument.defaultView!.HTMLAnchorElement &&
    element.getAttribute('aria-label') === 'Download';
}

function preferMediaUrl(video: URL | undefined, download: URL | undefined): URL | undefined {
  if (!video) return download;
  if (!download) return video;
  if (mediaKindFromUrl(download) !== 'video') return video;
  const videoPath = video.pathname;
  const lacksExtension = !/\.(?:mov|mp4|webm)$/i.test(videoPath);
  const proxied = /images-ext-\d+\.discordapp\.net$/i.test(video.hostname);
  return lacksExtension || proxied ? download : video;
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
    let downloadUrl: URL | undefined;
    for (const element of root.querySelectorAll<HTMLElement>(attachmentSelector)) {
      if (isDownloadAnchor(element)) {
        const url = attachmentUrl(element);
        if (url && mediaKindFromUrl(url) === 'video') downloadUrl = url;
      }
      const url = attachmentUrl(element);
      if (!url) continue;
      const kind = attachmentKind(element, url);
      if (!kind) continue;
      const resource = mediaResource(kind, url);
      if (targets.has(resource.id) && !element.matches('a[data-role="img"], video')) continue;
      targets.set(resource.id, { key: `${root.id}\u0000${resource.id}`, resource, element: attachmentFrame(element, root) });
    }
    if (downloadUrl) {
      for (const target of [...targets.values()]) {
        if (target.resource.kind !== 'video') continue;
        const chosen = preferMediaUrl(new URL(target.resource.url), downloadUrl);
        if (!chosen || chosen.href === target.resource.url) continue;
        targets.delete(target.resource.id);
        const resource = mediaResource('video', chosen);
        targets.set(resource.id, { ...target, key: `${root.id}\u0000${resource.id}`, resource });
      }
    }
    return [...targets.values()];
  }

  resolve(origin: Element): OwnedMediaTarget | undefined {
    const root = origin.closest<HTMLElement>(attachmentsSelector);
    if (!root) return undefined;
    return this.targetsIn(root).find(target => target.element.contains(origin));
  }
}
