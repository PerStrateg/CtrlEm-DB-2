/** Resolve the native WebExtensions namespace in Firefox and Chromium. */
export function webExtensionApi(): any {
  const globals = globalThis as { browser?: any; chrome?: any };
  return globals.browser ?? globals.chrome;
}
