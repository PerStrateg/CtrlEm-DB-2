export interface SiteResultError {
  command: string;
  code: 'http' | 'image-body-decode' | 'image-body-read' | 'stream-error' | 'timeout' | 'network' | 'site-rejected';
  status?: number;
  existing: boolean;
}

/** The receiver can report a media download failure after Send was accepted. */
export function observeSiteErrors(document: Document, report: (error: SiteResultError) => void): () => void {
  const seen = new Set<number>();
  let existing = true;
  const inspect = (item: Element) => {
    if (item.querySelector('.response-badge')?.textContent?.trim().toLowerCase() !== 'error') return;
    const body = item.querySelector('.response-body')?.textContent?.trim();
    if (!body) return;
    // The Results list is replaced on refresh. Retain only bounded fingerprints,
    // never its private body, and suppress identical errors on every refresh.
    let fingerprint = 2166136261;
    for (let index = 0; index < body.length; index++) fingerprint = Math.imul(fingerprint ^ body.charCodeAt(index), 16777619);
    if (seen.has(fingerprint)) return;
    if (seen.size === 512) seen.delete(seen.values().next().value!);
    seen.add(fingerprint);
    const httpStatus = /\bHTTP\s+([1-5]\d{2})\b/i.exec(body)?.[1];
    const code = httpStatus ? 'http' : /decoding response body/i.test(body) ? 'image-body-decode'
      : /reading image body|reading a body from connection/i.test(body) ? 'image-body-read'
      : /stream error/i.test(body) ? 'stream-error'
      : /timeout|timed out/i.test(body) ? 'timeout'
      : /network|connection/i.test(body) ? 'network' : 'site-rejected';
    report({ command: body.split(/\s/, 1)[0]!, code, existing, ...(httpStatus ? { status: Number(httpStatus) } : {}) });
  };
  const scan = (element: Element) => {
    if (element.matches('.response-item')) inspect(element);
    for (const item of element.querySelectorAll('.response-item')) inspect(item);
  };
  const resultsObserver = new document.defaultView!.MutationObserver(records => {
    for (const record of records) {
      // Ignore time-label updates and extension UI mutations.
      const element = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
      const body = element?.closest('#responses-container .response-body');
      if (body) inspect(body.closest('.response-item')!);
      for (const node of record.addedNodes) if (node.nodeType === 1) scan(node as Element);
    }
  });
  let container: HTMLElement | null = null;
  const bind = () => {
    const next = document.getElementById('responses-container');
    if (next === container) return;
    resultsObserver.disconnect(); container = next;
    if (container) {
      scan(container);
      resultsObserver.observe(container, { childList: true, characterData: true, subtree: true });
    }
  };
  bind(); existing = false;
  // Only look up the container here; extension UI mutations are never scanned.
  const mountObserver = new document.defaultView!.MutationObserver(bind);
  mountObserver.observe(document, { childList: true, subtree: true });
  return () => { mountObserver.disconnect(); resultsObserver.disconnect(); };
}
