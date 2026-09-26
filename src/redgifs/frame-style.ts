import { BTN_ATTR, HOST_CLASS, STYLE_ID, RAIL_ID } from './frame-config';
export function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
/* Per-video Send — CtrlEm-like, raised above bottom labels */
.${HOST_CLASS} {
  position: relative;
}
button[${BTN_ATTR}] {
  position: absolute;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  z-index: 2147483646;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem 1.15rem;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font: 500 0.875rem/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  color: #fff;
  background: #5865f2;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  transition: background 0.15s ease, opacity 0.15s ease;
}
button[${BTN_ATTR}]:hover:not(:disabled) {
  background: #4752c4;
}
button[${BTN_ATTR}]:disabled {
  opacity: 0.7;
  cursor: wait;
}
button[${BTN_ATTR}].is-busy { background: #3a45a8; }
button[${BTN_ATTR}].is-ok { background: #2a8f4a; }
button[${BTN_ATTR}].is-err { background: #c44; }

/* Native scrollbar hidden — custom overlay rail owns fast scrub. */
html.ctrlem-rg-embed .previewFeed {
  scrollbar-width: none !important;
}
html.ctrlem-rg-embed .previewFeed::-webkit-scrollbar {
  display: none !important;
  width: 0 !important;
}

#${RAIL_ID} {
  position: fixed;
  top: 56px;
  right: 0;
  bottom: 64px;
  width: 16px;
  z-index: 2147483647;
  pointer-events: auto;
  touch-action: none;
  cursor: ns-resize;
  background: rgba(0, 0, 0, 0.18);
  opacity: 0.55;
  transition: opacity 0.15s ease, background 0.15s ease;
}
#${RAIL_ID}:hover,
#${RAIL_ID}.is-dragging {
  opacity: 0.95;
  background: rgba(0, 0, 0, 0.35);
}
#${RAIL_ID} .ctrlem-rg-scroll-thumb {
  position: absolute;
  left: 3px;
  right: 3px;
  min-height: 28px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.45);
  pointer-events: none;
}
#${RAIL_ID}:hover .ctrlem-rg-scroll-thumb,
#${RAIL_ID}.is-dragging .ctrlem-rg-scroll-thumb {
  background: rgba(255, 255, 255, 0.7);
}
`;
  (document.head || document.documentElement).appendChild(style);
}

