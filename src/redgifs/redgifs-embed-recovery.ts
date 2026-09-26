import { sendRuntimeMessage } from './ext-runtime';
import { MessageType, type OpenTabResult } from './messaging';
import { rgWarn } from './rg-debug';

const SCOPE = 'rg-embed-recovery';
const VERIFY_URL = 'https://www.redgifs.com/';
const EMBED_HOME = 'https://www.redgifs.com/search/gifs';
const SHOWN_KEY = 'ctrlem.rgEmbedRecovery.shown';

function redgifsHost(): string {
  return location.hostname.replace(/^www\./i, '').toLowerCase();
}

function isRedgifsSite(): boolean {
  const host = redgifsHost();
  return host === 'redgifs.com' || host.endsWith('.redgifs.com');
}

function pageNeedsTopLevelVerify(): boolean {
  const text = `${document.title} ${document.body?.innerText || ''}`.slice(
    0,
    8000,
  );
  return (
    /RG Lite|Redirected to RG Lite/i.test(text) ||
    /isn't accepting cookies|isnt accepting cookies/i.test(text) ||
    /verify your age|complete age verification/i.test(text)
  );
}

async function openVerifyTab(): Promise<boolean> {
  const result = await sendRuntimeMessage<OpenTabResult>({
    type: MessageType.OpenTab,
    url: VERIFY_URL,
  });
  if (!result?.ok) {
    rgWarn(SCOPE, 'open tab failed', result);
    try {
      window.open(VERIFY_URL, '_blank', 'noopener,noreferrer');
      return true;
    } catch (error) {
      rgWarn(SCOPE, 'window.open failed', error);
      return false;
    }
  }
  return true;
}

function showRecovery(reason: string): void {
  try {
    if (sessionStorage.getItem(SHOWN_KEY) === reason) {
      // Still show — user may have bounced back to the same broken host.
    } else {
      sessionStorage.setItem(SHOWN_KEY, reason);
    }
  } catch {
    // ignore
  }

  window.stop();

  const root =
    document.documentElement ||
    document.appendChild(document.createElement('html'));
  root.innerHTML = `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RedGifs in CtrlEm</title><style>
html,body{margin:0;min-height:100%;background:#121212;color:#f2f2f2;font:16px/1.45 system-ui,sans-serif}
body{min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}
main{max-width:32rem;text-align:center}
p{color:#aaa}
.actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:16px}
button{padding:.65rem 1rem;border:0;border-radius:8px;background:#5865f2;color:#fff;font:600 1rem system-ui;cursor:pointer}
button.secondary{background:#2a2a33;color:#ddd}
button:disabled{opacity:.65;cursor:wait}
</style></head>
<body><main>
<h1>Open RedGifs to continue</h1>
<p>RedGifs sign-in or verification may be blocked inside CtrlEm. Complete it in a normal browser tab.</p>
<p>1) Open RedGifs → verify / sign in there.<br>2) Come back here and continue — CtrlEm will reuse that session.</p>
<div class="actions">
<button type="button" data-act="open">Open RedGifs in a tab</button>
<button type="button" class="secondary" data-act="continue">I've verified — Continue</button>
</div>
</main></body>`;

  const openBtn = root.querySelector<HTMLButtonElement>('[data-act="open"]');
  const contBtn = root.querySelector<HTMLButtonElement>('[data-act="continue"]');

  openBtn?.addEventListener('click', () => {
    void (async () => {
      openBtn.disabled = true;
      await openVerifyTab();
      openBtn.disabled = false;
    })();
  });

  contBtn?.addEventListener('click', () => {
    contBtn.disabled = true;
    try {
      sessionStorage.removeItem(SHOWN_KEY);
    } catch {
      // ignore
    }
    location.assign(EMBED_HOME);
  });
}

/**
 * Offer a top-level fallback when the page reports a verification problem.
 * Let auth pages load normally; a subdomain alone is not evidence of failure.
 */
export function installRedgifsEmbedRecovery(): void {
  if (!isRedgifsSite()) return;

  let shown = false;
  const maybeShow = () => {
    if (shown) return;
    if (!document.body) return;
    if (!pageNeedsTopLevelVerify()) return;
    shown = true;
    showRecovery('page-signal');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeShow, { once: true });
  } else {
    maybeShow();
  }
  window.setTimeout(maybeShow, 2500);
  window.setTimeout(maybeShow, 6000);
}
