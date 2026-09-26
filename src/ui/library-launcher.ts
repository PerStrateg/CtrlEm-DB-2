export interface LauncherState {
  open: boolean;
  available: boolean;
}

export class LibraryLauncher {
  readonly element: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly status: HTMLSpanElement;
  private previousState?: LauncherState;
  private readonly onClick: (event: MouseEvent) => void;

  constructor(document: Document, regionId: string, onToggle: () => void) {
    this.element = document.createElement('div');
    this.element.className = 'ctrlem-db-launcher ctrlem-db-ui';

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'ctrlem-db-button';
    this.button.textContent = 'DB';
    this.button.setAttribute('aria-controls', regionId);

    this.status = document.createElement('span');
    this.status.id = `${regionId}-availability`;
    this.status.className = 'ctrlem-db-availability';
    this.status.setAttribute('role', 'status');
    this.element.append(this.button, this.status);

    this.onClick = (event) => {
      event.stopPropagation();
      onToggle();
    };
    this.button.addEventListener('click', this.onClick);
  }

  render(state: LauncherState): void {
    if (this.previousState?.open === state.open &&
        this.previousState.available === state.available) return;
    this.previousState = state;
    this.button.disabled = !state.available;
    this.button.setAttribute('aria-expanded', String(state.open));
    this.button.setAttribute('aria-label', state.open ? 'Close library' : 'Open library');
    this.status.hidden = state.available;
    this.status.textContent = state.available ? '' : 'Library is unavailable on this page.';
    if (state.available) {
      this.button.removeAttribute('aria-describedby');
    } else {
      this.button.setAttribute('aria-describedby', this.status.id);
    }
  }

  focus(): void {
    this.button.focus({ preventScroll: true });
  }

  dispose(): void {
    this.button.removeEventListener('click', this.onClick);
    this.element.remove();
  }
}
