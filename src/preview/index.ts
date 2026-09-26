import { mountPlayer } from './player';
import '../ui/extension-theme.css';
import '../ui/common.css';
import './preview.css';

const parameters = new URLSearchParams(location.hash.slice(1));
const type = parameters.get('type');
// This web-accessible page accepts only media URLs, never extension or executable URLs.
let url: URL | undefined;
try { url = new URL(parameters.get('url') ?? ''); } catch { /* Invalid links have no player. */ }
if ((type === 'sound' || type === 'video') && url && ['https:', 'http:'].includes(url.protocol)) {
  const dispose = mountPlayer(document, type, url.href);
  const resize = new ResizeObserver(() => parent.postMessage({ type: 'ctrlem-preview:resize', height: document.body.scrollHeight }, 'https://ctrlem.com'));
  resize.observe(document.body);
  window.addEventListener('pagehide', () => { resize.disconnect(); dispose(); }, { once: true });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') parent.postMessage({ type: 'ctrlem-preview:close' }, 'https://ctrlem.com');
  }, { capture: true });
} else document.body.textContent = 'Couldn’t open this preview.';
