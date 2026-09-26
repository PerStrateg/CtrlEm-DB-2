import { RAIL_ID } from './frame-config';
const SCOPE = 'redgifs-scroll';
export function installOverlayScrollRail(
  getScrollRoot: () => HTMLElement | null,
): void {
  if (document.getElementById(RAIL_ID)) return;

  const rail = document.createElement('div');
  rail.id = RAIL_ID;
  rail.setAttribute('aria-hidden', 'true');
  const thumb = document.createElement('div');
  thumb.className = 'ctrlem-rg-scroll-thumb';
  rail.appendChild(thumb);
  (document.body || document.documentElement).appendChild(rail);

  let dragging = false;
  let syncTimer: number | null = null;

  const maxScroll = (root: HTMLElement) =>
    Math.max(0, root.scrollHeight - root.clientHeight);

  const syncThumb = () => {
    const root = getScrollRoot();
    if (!root) {
      rail.style.display = 'none';
      return;
    }
    const max = maxScroll(root);
    if (max <= 0) {
      rail.style.display = 'none';
      return;
    }
    rail.style.display = '';
    const track = rail.clientHeight;
    const ratio = root.clientHeight / root.scrollHeight;
    const thumbH = Math.max(28, Math.round(track * ratio));
    const travel = Math.max(0, track - thumbH);
    const top = travel === 0 ? 0 : (root.scrollTop / max) * travel;
    thumb.style.height = `${thumbH}px`;
    thumb.style.transform = `translateY(${top}px)`;
  };

  const scheduleSync = () => {
    if (syncTimer != null) return;
    syncTimer = window.requestAnimationFrame(() => {
      syncTimer = null;
      syncThumb();
    });
  };

  const scrubToClientY = (clientY: number) => {
    const root = getScrollRoot();
    if (!root) return;
    const max = maxScroll(root);
    if (max <= 0) return;
    const rect = rail.getBoundingClientRect();
    const track = rect.height;
    const thumbH = thumb.offsetHeight || 28;
    const travel = Math.max(1, track - thumbH);
    const y = Math.min(Math.max(clientY - rect.top - thumbH / 2, 0), travel);
    root.scrollTop = (y / travel) * max;
    syncThumb();
  };

  rail.addEventListener(
    'pointerdown',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      rail.classList.add('is-dragging');
      try {
        rail.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic / non-primary pointers may reject capture; scrub still runs.
      }
      scrubToClientY(event.clientY);
    },
    true,
  );
  rail.addEventListener(
    'pointermove',
    (event) => {
      if (!dragging) return;
      event.preventDefault();
      event.stopPropagation();
      scrubToClientY(event.clientY);
    },
    true,
  );
  const endDrag = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    rail.classList.remove('is-dragging');
    try {
      rail.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };
  rail.addEventListener('pointerup', endDrag, true);
  rail.addEventListener('pointercancel', endDrag, true);

  rail.addEventListener(
    'wheel',
    (event) => {
      const root = getScrollRoot();
      if (!root) return;
      event.preventDefault();
      event.stopPropagation();
      root.scrollTop += event.deltaY;
      syncThumb();
    },
    { passive: false, capture: true },
  );

  window.addEventListener('scroll', scheduleSync, { passive: true, capture: true });
  new MutationObserver(scheduleSync).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.setInterval(scheduleSync, 1000);
  syncThumb();
}
