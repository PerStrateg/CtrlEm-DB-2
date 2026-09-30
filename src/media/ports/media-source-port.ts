import type { MediaResource } from '../domain/media-resource';

/** Page media anchor: domain resource plus the DOM node that represents it. */
export interface MediaTarget {
  resource: MediaResource;
  element: HTMLElement;
}

/** Page-owned media anchor keyed by its attachment root, so repeats in different messages stay distinct. */
export interface OwnedMediaTarget extends MediaTarget {
  key: string;
}

/** Resolves media under an event origin, for hover-style interactions. */
export interface MediaSourcePort {
  resolve(origin: Element): MediaTarget | undefined;
}

/** Site-owned media that the page keeps re-rendering and that must be reconciled with mutations. */
export interface MediaAttachmentSourcePort extends MediaSourcePort {
  appliesTo(document: Document): boolean;
  roots(document: Document): HTMLElement[];
  rootsFor(records: MutationRecord[]): HTMLElement[];
  targetsIn(root: Element): OwnedMediaTarget[];
}