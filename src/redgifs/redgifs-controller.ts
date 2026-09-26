import { CtrlEmPage, type ResultsMount } from '../site/ctrlem-page';
import { ResultsController } from '../ui/results-controller';
import { RedgifsPanel } from '../ui/redgifs-panel';
import { loadRedgifsSession, REDGIFS_HOME } from './redgifs-overlay';
import { redgifsRequest } from './messaging';

export class RedgifsController {
  private readonly ui: RedgifsPanel;
  private open = false;
  private generation = 0;
  private mount?: ResultsMount;
  private target?: HTMLElement;
  private cleanups: (() => void)[] = [];
  constructor(private readonly page: CtrlEmPage, private readonly results: ResultsController,
    private readonly send: (url: string) => Promise<void>) {
    this.ui = new RedgifsPanel(page.document, {
      toggle: () => results.select(this.open ? 'site' : 'redgifs'),
      home: () => { this.generation++; this.ui.navigate(REDGIFS_HOME); },
      reload: () => { void this.restore(); },
      close: () => { results.select('site'); this.ui.button.focus({ preventScroll: true }); },
    });
  }
  start(): void {
    this.cleanups.push(this.results.subscribe(view => {
      this.open = view === 'redgifs';
      if (this.open) { this.reconcile(); if (this.target) this.page.alignResults(this.target); void this.restore(); }
      else { this.generation++; this.mount?.dispose(); this.mount = undefined; this.target = undefined; this.ui.stop(); }
      this.ui.render(this.open);
    }), this.page.observe(() => this.reconcile()));
    const win = this.page.document.defaultView!;
    const fit = () => this.ui.element.style.setProperty('--ctrlem-db-rg-height', `${this.page.redgifsHeight()}px`);
    win.addEventListener('resize', fit); win.visualViewport?.addEventListener('resize', fit);
    const listener = (message: unknown, sender: chrome.runtime.MessageSender, respond: (reply: unknown) => void) => {
      if ((message as { type?: string })?.type !== 'redgifs:send') return false;
      const parsed = redgifsRequest.safeParse(message);
      if (sender.id !== chrome.runtime.id || !this.open || !parsed.success || parsed.data.type !== 'redgifs:send') {
        respond({ ok: false, error: 'Open RedGifs before sending.' }); return false;
      }
      void this.send(parsed.data.url).then(() => respond({ ok: true }), error => respond({ ok: false,
        error: error instanceof Error ? error.message : 'Could not queue video.' }));
      return true;
    };
    chrome.runtime.onMessage.addListener(listener);
    this.cleanups.push(() => chrome.runtime.onMessage.removeListener(listener), () => {
      win.removeEventListener('resize', fit); win.visualViewport?.removeEventListener('resize', fit);
    });
    fit(); this.reconcile();
  }
  private reconcile(): void {
    if (!this.ui.launcher.isConnected) this.page.mountRedgifsLauncher(this.ui.launcher);
    if (!this.open) return;
    const panel = this.page.findTargets().resultsPanel;
    if (panel && (panel !== this.target || this.ui.element.parentElement !== panel)) {
      this.mount?.dispose(); this.target = panel; this.mount = this.page.mountRedgifs(panel, this.ui.element);
      this.mount.setOpen(true);
    }
  }
  private async restore(): Promise<void> {
    const generation = ++this.generation;
    try {
      const session = await loadRedgifsSession();
      if (this.open && generation === this.generation) { this.ui.error(''); this.ui.navigate(session.href); }
    } catch {
      if (this.open && generation === this.generation) this.ui.error('Could not load RedGifs session. Try Reload.');
    }
  }
  dispose(): void {
    this.generation++; this.open = false;
    for (const cleanup of this.cleanups) cleanup();
    this.mount?.dispose(); this.ui.stop(); this.page.removeRedgifsLauncher(this.ui.launcher);
  }
}
