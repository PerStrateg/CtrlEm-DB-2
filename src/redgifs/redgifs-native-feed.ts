import { isCtrlEmOverlayFrame } from './overlay-frame';

const REDGIFS_PHONE_MAX_WIDTH = 480;
const PATCH_MARKER = '__ctrlemRgNativeFeedViewport';
const SNAP_MARKER = 'data-ctrlem-native-snap';

/**
 * RedGifs uses its phone layout for a full-height, snap-scrolling feed, but
 * selects the tablet layout above 480px. A CtrlEm results iframe is commonly
 * wider than that while still being too short for the tablet card geometry.
 *
 * Report the iframe as phone-width / coarse-pointer to RedGifs' JS responsive
 * state. The real CSS viewport is untouched: RedGifs remains responsible for
 * dimensions, overflow, snap behavior, and playback queue handling.
 */
export function installRedgifsNativeFeedViewport(win: Window = window): void {
  if (!isCtrlEmOverlayFrame(win, 'rg')) return;
  const marked = win as Window & Record<string, unknown>;
  if (marked[PATCH_MARKER]) return;
  marked[PATCH_MARKER] = true;

  installPhoneViewportSpoof(win);
  installTouchHints(win);
  installSnapFeedGuard(win);
}

function phoneWidth(win: Window): number {
  const raw = win.visualViewport?.width ?? win.document.documentElement?.clientWidth;
  const fallback = typeof raw === 'number' && raw > 0 ? raw : REDGIFS_PHONE_MAX_WIDTH;
  return Math.min(Math.max(1, Math.round(fallback)), REDGIFS_PHONE_MAX_WIDTH);
}

function installPhoneViewportSpoof(win: Window): void {
  const widthDesc = {
    configurable: true,
    enumerable: true,
    get: () => phoneWidth(win),
  };
  Object.defineProperty(win, 'innerWidth', widthDesc);
  Object.defineProperty(win, 'outerWidth', widthDesc);

  const docEl = win.document.documentElement;
  if (docEl) {
    try {
      Object.defineProperty(docEl, 'clientWidth', {
        configurable: true,
        enumerable: true,
        get: () => phoneWidth(win),
      });
    } catch {
      // Some browsers reject redefining clientWidth; matchMedia spoof still helps.
    }
  }

  const nativeMatchMedia = win.matchMedia.bind(win);
  win.matchMedia = ((query: string) => {
    const forced = forcePhoneMediaQuery(query);
    if (forced != null) {
      // Consumers may call MediaQueryList.prototype.addListener.call(mql, cb).
      // A plain-object substitute fails the native receiver check in Firefox
      // and crashes React when a new feed card mounts.
      const mql = nativeMatchMedia(forced ? '(min-width: 0px)' : 'not all');
      Object.defineProperty(mql, 'media', { configurable: true, value: query });
      return mql;
    }
    return rewriteWidthMediaQuery(nativeMatchMedia, query, () => phoneWidth(win));
  }) as typeof win.matchMedia;
}

function forcePhoneMediaQuery(query: string): boolean | null {
  const q = query.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/\(pointer:\s*coarse\)/.test(q)) return true;
  if (/\(pointer:\s*fine\)/.test(q)) return false;
  if (/\(hover:\s*none\)/.test(q)) return true;
  if (/\(hover:\s*hover\)/.test(q)) return false;
  if (/\(any-pointer:\s*coarse\)/.test(q)) return true;
  if (/\(any-pointer:\s*fine\)/.test(q)) return false;
  if (/\(any-hover:\s*none\)/.test(q)) return true;
  if (/\(any-hover:\s*hover\)/.test(q)) return false;
  return null;
}

function rewriteWidthMediaQuery(
  nativeMatchMedia: (q: string) => MediaQueryList,
  query: string,
  width: () => number,
): MediaQueryList {
  const rewritten = query.replace(
    /\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)\s*\)/gi,
    (full, kind: string, num: string, unit: string) => {
      const px = toPx(Number(num), unit);
      if (!Number.isFinite(px)) return full;
      const w = width();
      const matches = kind.toLowerCase() === 'max' ? w <= px : w >= px;
      return matches ? '(min-width: 0px)' : '(max-width: -1px)';
    },
  );
  return nativeMatchMedia(rewritten === query ? query : rewritten);
}

function toPx(value: number, unit: string): number {
  switch (unit.toLowerCase()) {
    case 'em':
    case 'rem':
      return value * 16;
    default:
      return value;
  }
}

function installTouchHints(win: Window): void {
  const nav = win.navigator;
  let priorTouchPoints = 0;
  try {
    priorTouchPoints = Number(nav.maxTouchPoints) || 0;
  } catch {
    priorTouchPoints = 0;
  }
  try {
    Object.defineProperty(nav, 'maxTouchPoints', {
      configurable: true,
      enumerable: true,
      get: () => Math.max(1, priorTouchPoints),
    });
  } catch {
    // ignore
  }
  const doc = win.document;
  if (!('ontouchstart' in win)) {
    try {
      (win as Window & { ontouchstart: null }).ontouchstart = null;
    } catch {
      // ignore
    }
  }
  if (doc && !('ontouchstart' in doc.documentElement)) {
    try {
      (doc.documentElement as HTMLElement & { ontouchstart: null }).ontouchstart =
        null;
    } catch {
      // ignore
    }
  }
}

function installSnapFeedGuard(win: Window): void {
  const syncNativeSnapFeed = () => {
    const doc = win.document;
    const root = doc.getElementById('root');
    if (!root) return;

    const isWatchPage = /^\/(?:watch|ifr)\//i.test(win.location.pathname);
    const hasFeed = Boolean(doc.querySelector('.previewFeed'));
    if (hasFeed && !isWatchPage) {
      if (!root.classList.contains('withSnapFeed')) {
        root.classList.add('withSnapFeed');
      }
      root.setAttribute(SNAP_MARKER, '1');
      return;
    }

    if (root.hasAttribute(SNAP_MARKER)) {
      root.classList.remove('withSnapFeed');
      root.removeAttribute(SNAP_MARKER);
    }
  };

  const observer = new (win as Window & typeof globalThis).MutationObserver(syncNativeSnapFeed);
  observer.observe(win.document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  win.addEventListener('popstate', syncNativeSnapFeed);
  syncNativeSnapFeed();
}
