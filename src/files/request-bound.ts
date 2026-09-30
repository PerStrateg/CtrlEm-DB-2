/** Bounded request: cancellation stays immediate, a stalled peer can never hold a queue forever. */
export function bounded(timeoutMs: number, signal?: AbortSignal): { signal: AbortSignal; dispose(): void } {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const cancel = () => abort.abort();
  if (!signal) return { signal: abort.signal, dispose: () => clearTimeout(timer) };
  if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
  return { signal: abort.signal, dispose: () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); } };
}
