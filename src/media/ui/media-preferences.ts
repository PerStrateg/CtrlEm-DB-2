/** Page-scoped composer preferences: one read, serialized writes, one change signal for every mounted control. */
import type { MediaComposerPreferences } from '../domain/media-composer';
import type { MediaSettingsPort } from '../ports/media-settings-port';

export class MediaPreferencesStore {
  private value?: MediaComposerPreferences;
  private confirmed?: MediaComposerPreferences;
  private tail: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private pending = 0;
  private unsubscribe?: () => void;
  private disposed = false;
  constructor(private readonly settings: MediaSettingsPort,
    private readonly onChange: (preferences?: MediaComposerPreferences) => void) {}

  get current(): MediaComposerPreferences | undefined { return this.value; }
  get recipientNames(): string { return this.value?.selectedRecipients.map(item => item.label).join(', ') ?? ''; }

  async load(): Promise<void> {
    this.unsubscribe = this.settings.subscribeComposer(value => {
      this.confirmed = value;
      if (!this.pending) this.accept(value);
    });
    const revision = this.revision;
    const loaded = await this.settings.loadComposer();
    if (revision === this.revision) { this.confirmed = loaded; this.accept(loaded); }
  }

  private accept(value: MediaComposerPreferences): void {
    if (this.disposed) return;
    this.revision++; this.value = value; this.onChange(value);
  }

  dispose(): void { this.disposed = true; this.revision++; this.unsubscribe?.(); }
  async flush(): Promise<void> { await this.tail; }

  /** Applied optimistically and written in order, so the next change never reads a stale snapshot. */
  commit(preferences: MediaComposerPreferences): Promise<MediaComposerPreferences> {
    this.pending++; this.accept(preferences);
    const written = this.tail.catch(() => undefined).then(() => this.settings.saveComposer(preferences))
      .then(saved => { this.confirmed = saved; return saved; }).finally(() => {
      this.pending--;
      if (!this.pending && this.confirmed) this.accept(this.confirmed);
    });
    this.tail = written;
    return written;
  }
}
