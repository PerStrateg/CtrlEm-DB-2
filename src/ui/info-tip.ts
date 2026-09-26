/** Shared information buttons. Copy remains with the feature that owns it. */
export function createInfoButton(document: Document, label: string, copy: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ctrlem-db-info';
  button.textContent = 'i';
  button.setAttribute('aria-label', label);
  button.dataset.info = copy;
  return button;
}

/** One top-layer tooltip per document, including dynamically mounted controls. */
export function mountInfoTips(document: Document): () => void {
  const window = document.defaultView!;
  const tip = document.createElement('div');
  tip.className = 'ctrlem-db-tooltip';
  tip.id = 'ctrlem-db-tooltip';
  tip.setAttribute('popover', 'manual');
  tip.setAttribute('role', 'tooltip');
  document.body.append(tip);
  let active: HTMLButtonElement | undefined;
  let pinned = false;
  let hovered = false;
  let tipHovered = false;
  let suppressed: HTMLButtonElement | undefined;
  let timer: number | undefined;
  const buttonAt = (target: EventTarget | null) => target instanceof window.Element
    ? target.closest<HTMLButtonElement>('button.ctrlem-db-info') : null;
  const close = () => {
    window.clearTimeout(timer);
    observer.disconnect();
    active?.removeAttribute('aria-describedby');
    if (active) tip.hidePopover();
    active = undefined; pinned = hovered = tipHovered = false;
  };
  const position = () => {
    if (!active) return;
    if (!active.isConnected || !active.getClientRects().length) { close(); return; }
    const copy = active.dataset.info ?? '';
    if (tip.textContent !== copy) tip.textContent = copy;
    const anchor = active.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const width = document.documentElement.clientWidth, height = window.innerHeight;
    const left = Math.max(8, Math.min(anchor.left + (anchor.width - box.width) / 2, width - box.width - 8));
    const above = anchor.top - box.height - 8;
    const top = Math.max(8, Math.min(above >= 8 ? above : anchor.bottom + 8, height - box.height - 8));
    tip.style.left = `${left}px`; tip.style.top = `${top}px`;
  };
  const observer = new window.MutationObserver(position);
  const open = (button: HTMLButtonElement) => {
    window.clearTimeout(timer);
    if (active === button || suppressed === button) return;
    close(); active = button;
    tip.textContent = button.dataset.info ?? '';
    button.setAttribute('aria-describedby', tip.id);
    tip.showPopover(); position();
    observer.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['hidden', 'data-info', 'class'] });
  };
  const leave = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (!pinned && !hovered && !tipHovered && document.activeElement !== active) close();
    }, 100);
  };
  const over = (event: PointerEvent) => {
    if (tip.contains(event.target as Node)) { tipHovered = true; window.clearTimeout(timer); return; }
    const button = buttonAt(event.target);
    if (button && (!pinned || active === button)) { open(button); hovered = active === button; }
  };
  const out = (event: PointerEvent) => {
    if (tip.contains(event.target as Node) && !tip.contains(event.relatedTarget as Node | null)) { tipHovered = false; leave(); }
    const button = buttonAt(event.target);
    if (button && !button.contains(event.relatedTarget as Node | null)) {
      if (suppressed === button) suppressed = undefined;
      if (active === button) { hovered = false; leave(); }
    }
  };
  const focus = (event: FocusEvent) => { const button = buttonAt(event.target); if (button) { suppressed = undefined; open(button); } };
  const blur = () => { suppressed = undefined; leave(); };
  const click = (event: MouseEvent) => {
    const button = buttonAt(event.target);
    if (button) {
      if (active === button && pinned) { close(); suppressed = button; }
      else { suppressed = undefined; open(button); pinned = true; }
    } else if (!tip.contains(event.target as Node)) close();
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && active) { suppressed = active; close(); event.preventDefault(); event.stopPropagation(); }
  };
  document.addEventListener('pointerover', over);
  document.addEventListener('pointerout', out);
  document.addEventListener('focusin', focus);
  document.addEventListener('focusout', blur);
  document.addEventListener('click', click);
  document.addEventListener('keydown', key, true);
  window.addEventListener('scroll', position, true);
  window.addEventListener('resize', position);
  return () => {
    close(); tip.remove();
    document.removeEventListener('pointerover', over); document.removeEventListener('pointerout', out);
    document.removeEventListener('focusin', focus); document.removeEventListener('focusout', blur);
    document.removeEventListener('click', click); document.removeEventListener('keydown', key, true);
    window.removeEventListener('scroll', position, true); window.removeEventListener('resize', position);
  };
}
