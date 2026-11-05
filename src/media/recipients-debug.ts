/** Console diagnostics for recipient search failures. Copy lines tagged [CtrlEm DB][recipients]. */
export const recipientsDebugTag = '[CtrlEm DB][recipients]';

export function describeRecipientsError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const details: Record<string, unknown> = { name: error.name, message: error.message };
    const status = (error as { status?: number }).status;
    if (typeof status === 'number') details.httpStatus = status;
    if (error.name === 'ZodError' && 'issues' in error) {
      details.zodIssues = (error as { issues: { path: unknown[]; message: string }[] }).issues
        .slice(0, 8).map(issue => ({ path: issue.path.join('.'), message: issue.message }));
    }
    return details;
  }
  return { thrown: String(error) };
}

export function logRecipients(stage: string, details: Record<string, unknown>): void {
  console.warn(recipientsDebugTag, stage, details);
}

export function logRecipientsHint(): void {
  console.info(recipientsDebugTag,
    'Copy every line above that starts with this tag. Also open the extension service worker console (browser extensions page → CtrlEm DB → Inspect service worker / background) and copy matching lines there.');
}
