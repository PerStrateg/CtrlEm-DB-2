import { websiteAccess } from '../shared/website-access';

/**
 * First install and update only: open the options page when the user still has
 * no website access. Never requests access from the background.
 */
export function registerWebsiteAccessOnboarding(permissions: Pick<typeof chrome.permissions, 'contains'>, runtime: Pick<typeof chrome.runtime, 'onInstalled'>, openOptions: () => void): void {
  const onboardingReasons: ReadonlySet<string> = new Set(['install', 'update']);
  runtime.onInstalled.addListener(details => {
    if (!onboardingReasons.has(details.reason)) return;
    void permissions.contains(websiteAccess).then(granted => { if (!granted) openOptions(); }, () => undefined);
  });
}
