const viewportMargin = 10, anchorGap = 8;

/** Keeps a popover inside every viewport edge, flipping above the anchor when it does not fit below. */
export function placePanel(anchor: Pick<DOMRect, 'top' | 'right' | 'bottom'>,
  panel: Pick<DOMRect, 'width' | 'height'>, viewport: { width: number; height: number }): { left: number; top: number } {
  const left = Math.min(viewport.width - panel.width - viewportMargin, Math.max(viewportMargin, anchor.right - panel.width));
  const below = anchor.bottom + anchorGap, above = anchor.top - panel.height - anchorGap;
  return { left: Math.max(viewportMargin, left), top: below + panel.height <= viewport.height - viewportMargin ? below : Math.max(viewportMargin, above) };
}
