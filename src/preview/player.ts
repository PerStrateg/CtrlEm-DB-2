import type { MediaType } from '../ui/media-preview';

/** Renders media only; no library, credentials or command access. */
export function mountPlayer(document: Document, type: MediaType, url: string): () => void {
  const media = document.createElement(type === 'sound' ? 'audio' : 'video');
  media.controls = true; media.preload = 'metadata'; media.autoplay = false;
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry';
  const load = () => { status.textContent = 'Loading…'; retry.hidden = true; media.src = url; media.load(); };
  const ready = () => { status.textContent = ''; retry.hidden = true; };
  const failed = () => { status.textContent = 'Couldn’t play this file.'; retry.hidden = false; };
  media.addEventListener('loadedmetadata', ready); media.addEventListener('error', failed);
  retry.addEventListener('click', load);
  document.body.append(media, status, retry); load();
  return () => {
    media.removeEventListener('loadedmetadata', ready); media.removeEventListener('error', failed);
    retry.removeEventListener('click', load);
    media.pause(); media.removeAttribute('src'); media.load();
    media.remove(); status.remove(); retry.remove();
  };
}
