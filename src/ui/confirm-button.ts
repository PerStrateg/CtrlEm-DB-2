interface ConfirmActions {
  request(): void;
  confirm(): void;
  cancel?(): void;
}

/** Two sibling controls share one visual button; cancellation never activates the action. */
export class ConfirmButton {
  readonly element: HTMLSpanElement;
  readonly cancelButton: HTMLButtonElement;
  private label: string;
  private readonly visibility: MutationObserver;
  get armed(): boolean { return this.element.dataset.confirming === 'true'; }

  constructor(readonly button: HTMLButtonElement, private readonly actions: ConfirmActions) {
    const document = button.ownerDocument;
    this.label = button.textContent ?? '';
    this.visibility = new document.defaultView!.MutationObserver(() => {
      if (!this.element.isConnected) { this.reset(); return; }
      for (let parent: HTMLElement | null = this.element; parent; parent = parent.parentElement) {
        if (parent.hidden || document.defaultView!.getComputedStyle(parent).display === 'none') { this.cancel(); return; }
      }
    });
    this.element = document.createElement('span'); this.element.className = 'ctrlem-db-confirm-button';
    button.replaceWith(this.element); this.element.append(button);
    this.cancelButton = document.createElement('button'); this.cancelButton.type = 'button';
    this.cancelButton.className = 'ctrlem-db-remove-button ctrlem-db-confirm-cancel';
    this.cancelButton.textContent = '×'; this.cancelButton.setAttribute('aria-label', 'Cancel'); this.cancelButton.title = 'Cancel';
    this.cancelButton.hidden = true; this.element.append(this.cancelButton);
    button.addEventListener('click', () => { if (this.armed) actions.confirm(); else actions.request(); });
    this.cancelButton.addEventListener('click', () => this.cancel(true));
    this.element.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !this.armed) return;
      event.preventDefault(); event.stopPropagation(); this.cancel(true);
    });
    this.element.addEventListener('ctrlem-db:cancel-confirmation', () => this.cancel(false));
  }

  arm(info: string): void {
    if (!this.armed) {
      this.label = this.button.textContent ?? '';
      this.element.style.minWidth = `${this.button.getBoundingClientRect().width}px`;
      this.element.dataset.confirming = 'true'; this.button.textContent = 'Sure?'; this.cancelButton.hidden = false;
      this.visibility.observe(this.button.ownerDocument, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['hidden', 'class', 'style'] });
    }
    if (this.button.dataset.info !== info) this.button.dataset.info = info;
  }

  reset(): void {
    if (!this.armed) return;
    this.visibility.disconnect();
    delete this.element.dataset.confirming; delete this.button.dataset.info;
    this.button.textContent = this.label; this.element.style.removeProperty('min-width');
    this.cancelButton.hidden = true;
  }

  cancel(focus = false): void {
    if (!this.armed || this.button.matches(':disabled')) return;
    this.reset(); this.actions.cancel?.();
    if (focus) this.button.focus({ preventScroll: true });
  }

  disabled(value: boolean): void { this.button.disabled = value; this.cancelButton.disabled = value; }
}

export function cancelConfirmations(container: HTMLElement): boolean {
  const active = container.querySelectorAll('[data-confirming="true"]');
  for (const element of active) {
    element.dispatchEvent(new container.ownerDocument.defaultView!.Event('ctrlem-db:cancel-confirmation'));
  }
  return active.length > 0;
}

export function bindConfirmationEscape(container: HTMLElement): void {
  container.addEventListener('keydown', event => {
    if (event.key === 'Escape' && cancelConfirmations(container)) { event.preventDefault(); event.stopPropagation(); }
  });
}
