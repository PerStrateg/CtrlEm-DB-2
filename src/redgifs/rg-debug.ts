/** Log operation names only: never API bodies, tokens or cookie values. */
export function rgWarn(scope: string, message: string, _data?: unknown): void {
  console.warn(`[CtrlEm DB RG] ${scope}: ${message}`);
}
export function rgError(scope: string, message: string, _data?: unknown): void {
  console.error(`[CtrlEm DB RG] ${scope}: ${message}`);
}
