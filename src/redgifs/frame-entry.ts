import { createVideoResolver } from './video-api';
import {
  MessageType,
  type RedgifsOverlaySendMessage,
  type RedgifsOverlaySendResult,
} from './messaging';
import {
  loadRedgifsSession,
  saveRedgifsSession,
} from './redgifs-overlay';
import { isRedgifsBrowseHref } from './redgifs-frame';
import { isCtrlEmOverlayFrame } from './overlay-frame';
import { rgError, rgWarn } from './rg-debug';
import { sendRuntimeMessage } from './ext-runtime';

import { BTN_ATTR, HOST_CLASS } from './frame-config';
import { ensureStyles } from './frame-style';
import { installOverlayScrollRail } from './scroll-rail';
const SCOPE = 'redgifs-frame';

/**
 * Send button mounted on each RedGifs video card (and watch player).
 * Uses that card's data-feed-item-id / watch slug — no global guess.
 */
function main(): void {
    if (!isCtrlEmOverlayFrame(window, 'rg')) {
      return;
    }
    document.documentElement.classList.add('ctrlem-rg-embed');
    startPerVideoSend();
}

main();

function startPerVideoSend(): void {
  const mp4FromApi = createVideoResolver();
  let sendingSlug: string | null = null;
  let lastHref = '';
  let sessionReady = false;
  let scrollRestoreTried = false;

  ensureStyles();
  void restoreSession().catch(() => rgWarn(SCOPE, 'session restore failed')).finally(() => { sessionReady = true; });

  const scrollRoot = (): HTMLElement | null => {
    const feed = document.querySelector<HTMLElement>('.previewFeed');
    if (feed && feed.scrollHeight > feed.clientHeight + 20) return feed;
    const app = document.querySelector<HTMLElement>('.App');
    if (app && app.scrollHeight > app.clientHeight + 20) return app;
    return (
      (document.scrollingElement as HTMLElement | null) || document.documentElement
    );
  };

  installOverlayScrollRail(scrollRoot);

  const normalizeSlug = (raw: string | null | undefined): string | null => {
    const slug = String(raw || '')
      .trim()
      .toLowerCase();
    if (!slug || slug === 'null' || slug === 'undefined') return null;
    if (slug.startsWith('feed-module-') || /pos-\d+/i.test(slug)) return null;
    return /^[a-z][a-z0-9]{2,100}$/i.test(slug) ? slug : null;
  };

  const slugFromPath = (): string | null => {
    const match = location.pathname.match(/\/(?:watch|ifr)\/([^/?#]+)/i);
    return match ? normalizeSlug(decodeURIComponent(match[1]!)) : null;
  };

  const persistHref = () => {
    if (!sessionReady) return;
    const href = location.href;
    if (!isRedgifsBrowseHref(href) || href === lastHref) return;
    lastHref = href;
    void saveRedgifsSession({ href, scrollY: scrollRoot()?.scrollTop ?? 0 }).catch(() => rgWarn(SCOPE, 'session save failed'));
  };

  let scrollSaveTimer: number | null = null;
  const persistScroll = () => {
    if (scrollSaveTimer != null) window.clearTimeout(scrollSaveTimer);
    scrollSaveTimer = window.setTimeout(() => {
      scrollSaveTimer = null;
      const root = scrollRoot();
      const scrollY = root?.scrollTop ?? window.scrollY;
      void saveRedgifsSession({ scrollY }).catch(() => rgWarn(SCOPE, 'position save failed'));
    }, 250);
  };

  async function restoreSession() {
    const session = await loadRedgifsSession();
    lastHref = isRedgifsBrowseHref(location.href) ? location.href : session.href;
    if (
      (isCtrlEmOverlayFrame(window, 'rg') || window === window.top) &&
      isRedgifsBrowseHref(location.href) &&
      location.href !== session.href
    ) {
      void saveRedgifsSession({ href: location.href, scrollY: 0 }).catch(() => rgWarn(SCOPE, 'session save failed'));
    }

    if (location.href !== session.href || scrollRestoreTried || session.scrollY <= 0) return;
    scrollRestoreTried = true;
    const target = session.scrollY;
    const tryRestore = (attempt: number) => {
      const root = scrollRoot();
      if (!root) return;
      if (root.scrollHeight > target + root.clientHeight * 0.5 || attempt >= 20) {
        root.scrollTop = target;
        return;
      }
      window.setTimeout(() => tryRestore(attempt + 1), 200);
    };
    window.setTimeout(() => tryRestore(0), 400);
  }

  const sendSlug = async (btn: HTMLButtonElement, slug: string) => {
    if (sendingSlug) {
      rgWarn(SCOPE, 'send ignored — already sending', {
        sendingSlug,
        requested: slug,
      });
      return;
    }
    sendingSlug = slug;
    btn.disabled = true;
    btn.textContent = '…';
    btn.classList.remove('is-ok', 'is-err');
    btn.classList.add('is-busy');

    try {
      const url = await mp4FromApi(slug);
      if (!url) throw new Error('Could not load the video URL. Try Send again.');

      const message: RedgifsOverlaySendMessage = {
        type: MessageType.RedgifsOverlaySend,
        url,
        slug,
      };
      const result = await sendRuntimeMessage<RedgifsOverlaySendResult>(
        message,
      );
      if (!result?.ok) throw new Error(result?.error || 'Send failed');

      btn.textContent = 'Queued';
      btn.classList.add('is-ok');
    } catch (err) {
      rgError(SCOPE, 'send: failed', err);
      btn.textContent = 'Retry Send';
      btn.title = err instanceof Error ? err.message : 'Could not queue video. Try Send again.';
      btn.classList.add('is-err');
    } finally {
      sendingSlug = null;
      btn.disabled = false;
      btn.classList.remove('is-busy');
      setTimeout(() => {
        if (btn.classList.contains('is-err')) return;
        btn.textContent = 'Send';
        btn.classList.remove('is-ok', 'is-err');
      }, 1400);
    }
  };

  const placeButton = (host: HTMLElement, slug: string, watch = false) => {
    host.classList.add(HOST_CLASS);

    let btn = host.querySelector<HTMLButtonElement>(`[${BTN_ATTR}]`);
    const created = !btn;
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute(BTN_ATTR, '1');
      btn.setAttribute('aria-live', 'polite');
      btn.className = 'btn btn-primary';
      btn.textContent = 'Send';
      host.appendChild(btn);
    }
    const prev = btn.dataset.slug || null;
    if (!created && prev === slug && Boolean(btn.dataset.watch) === watch) {
      return;
    }
    btn.dataset.slug = slug;
    btn.title = `Send ${slug} to CtrlEm`;
    if (watch) btn.dataset.watch = '1';
    else delete btn.dataset.watch;
  };

  const syncFeed = () => {
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>('[data-feed-item-id]'),
    );

    for (const card of cards) {
      const raw = card.getAttribute('data-feed-item-id');
      const slug = normalizeSlug(raw);
      if (!slug) {
        card.querySelector(`[${BTN_ATTR}]`)?.remove();
        continue;
      }
      const host =
        card.matches('.GifPreview') || card.classList.contains('GifPreview')
          ? card
          : card.closest<HTMLElement>('.GifPreview') || card;
      placeButton(host, slug);
    }

  };

  const syncWatch = () => {
    const slug = slugFromPath();
    if (!slug) {
      return;
    }
    const host =
      document.querySelector<HTMLElement>('.Player') ||
      document.querySelector<HTMLElement>('.GifPreview_isActive') ||
      document.querySelector('video')?.parentElement;
    if (!host) {
      rgWarn(SCOPE, 'sync: watch — no player host', { slug });
      return;
    }
    placeButton(host, slug, true);
  };

  const sync = () => {
    const hasFeed = Boolean(document.querySelector('[data-feed-item-id]'));
    if (hasFeed) syncFeed();
    else syncWatch();
  };

  document.addEventListener(
    'click',
    (event) => {
      const btn = (event.target as Element | null)?.closest?.(
        `button[${BTN_ATTR}]`,
      ) as HTMLButtonElement | null;
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const slug = normalizeSlug(btn.dataset.slug);
      if (!slug) {
        rgWarn(SCOPE, 'click: button has no valid slug', {
          dataset: { ...btn.dataset },
        });
        return;
      }
      void sendSlug(btn, slug);
    },
    true,
  );

  for (const type of ['pointerdown', 'mousedown', 'touchstart'] as const) {
    document.addEventListener(
      type,
      (event) => {
        const btn = (event.target as Element | null)?.closest?.(
          `button[${BTN_ATTR}]`,
        );
        if (!btn) return;
        event.stopPropagation();
        event.stopImmediatePropagation();
      },
      true,
    );
  }

  let scheduled = false;
  const scheduleSync = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      sync();
    });
  };

  const onScroll = () => persistScroll();
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  scrollRoot()?.addEventListener('scroll', onScroll, { passive: true });

  sync();
  persistHref();
  setInterval(() => {
    sync();
    persistHref();
  }, 1000);
  new MutationObserver(scheduleSync).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-feed-item-id'],
  });
}

