export type ResultsView = 'site' | 'library' | 'redgifs';

/** One owner for the visible Results view; each panel retains its own data. */
export class ResultsController {
  private view: ResultsView = 'site';
  private readonly listeners = new Set<(view: ResultsView) => void>();
  select(view: ResultsView): void {
    if (this.view === view) return;
    this.view = view;
    for (const listener of this.listeners) listener(view);
  }
  subscribe(listener: (view: ResultsView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
