/** RedGifs' queue observer uses an implicit cross-origin root and percentage
 * margins. Give only that observer a concrete feed-local focus band. Keep the
 * native queue, lazy mounting, player controls and preload observers intact. */
export function installRedgifsFeedFocus(win: Window & typeof globalThis): void {
  const NativeObserver = win.IntersectionObserver;
  const marker = 'data-ctrlem-feed-focus';
  if (win.document.documentElement.hasAttribute(marker)) return;
  win.document.documentElement.setAttribute(marker, '1');

  win.IntersectionObserver = class extends NativeObserver {
    private delegate: IntersectionObserver | null = null;
    private targets = new Set<Element>();
    private resize: ResizeObserver | null = null;
    private feed: Element | null = null;
    private margin = '';
    private queued = 0;
    private readonly isQueue: boolean;

    constructor(private callback: IntersectionObserverCallback, private options?: IntersectionObserverInit) {
      super(callback, options);
      this.isQueue = !options?.root && options?.rootMargin?.trim().replace(/\s+/g, ' ') === '-50% 0px -50% 0px';
    }

    private refresh = (): void => {
      this.queued = 0;
      if (!this.feed || !this.targets.size) return;
      const rect = this.feed.getBoundingClientRect();
      const viewportHeight = win.visualViewport?.height ?? win.innerHeight;
      const top = Math.max(0, rect.top);
      const bottom = Math.min(viewportHeight, rect.bottom);
      const center = (top + Math.max(top, bottom)) / 2 - rect.top;
      const margin = `${-Math.max(0, center - 1)}px 0px ${-Math.max(0, rect.height - center - 1)}px 0px`;
      if (this.delegate && margin === this.margin) return;
      this.margin = margin;
      this.delegate?.disconnect();
      const observer = new NativeObserver((entries) => {
        // Ignore deliveries queued by a replaced/disconnected observer.
        if (this.delegate === observer) this.callback(entries, this);
      }, { ...this.options, root: this.feed, rootMargin: margin });
      this.delegate = observer;
      for (const target of this.targets) observer.observe(target);
    };

    private schedule = (): void => {
      if (!this.queued) this.queued = win.requestAnimationFrame(this.refresh);
    };

    override observe(target: Element): void {
      const feed = target.closest('.previewFeed');
      if (!this.isQueue || !target.matches('.GifPreview') || !feed) {
        super.observe(target);
        return;
      }
      if (!this.feed) {
        this.feed = feed;
        this.resize = new win.ResizeObserver(this.schedule);
        this.resize.observe(feed);
        win.addEventListener('resize', this.schedule);
        win.addEventListener('scroll', this.schedule, true);
        win.visualViewport?.addEventListener('resize', this.schedule);
      }
      this.targets.add(target);
      if (this.delegate) this.delegate.observe(target);
      else this.refresh();
    }

    override unobserve(target: Element): void {
      super.unobserve(target);
      this.delegate?.unobserve(target);
      this.targets.delete(target);
      if (!this.targets.size) this.disconnect();
    }

    override disconnect(): void {
      super.disconnect();
      this.delegate?.disconnect();
      this.delegate = null;
      this.targets.clear();
      this.resize?.disconnect();
      this.resize = null;
      this.feed = null;
      win.removeEventListener('resize', this.schedule);
      win.removeEventListener('scroll', this.schedule, true);
      win.visualViewport?.removeEventListener('resize', this.schedule);
      if (this.queued) win.cancelAnimationFrame(this.queued);
      this.queued = 0;
    }

    override takeRecords(): IntersectionObserverEntry[] {
      return [...super.takeRecords(), ...(this.delegate?.takeRecords() ?? [])];
    }
  };
}
