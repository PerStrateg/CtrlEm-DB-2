/** Explicit Redgifs components, including the older userscript's feed modules. */
export const hiddenEmbedSelectors = [
  '.cky-consent-container', '.cky-modal', '.cky-overlay', '.cky-btn-revisit-wrapper',
  '#ctrlem-storage-access', '.previewFeed .FeedModule', '.bannerWrapper',
  '.AdCreator', '.OnlyFansCreatorsSidebar', '.adSearchLink', '.aTab',
  '.liveAdButton', '.sideBarItem:has(.liveAdButton)',
  '[class*="_advertFooter_"]', '[class*="_StreamateCamera_"]',
  'a[href*="rgcams.com/"]', 'a[href*="a.aivanta76.com/"]',
] as const;

/** Installed before page UI mounts; CSS also covers later SPA insertions. */
export function installEmbedCleanup(doc: Document = document): void {
  if (doc.getElementById('ctrlem-rg-cleanup')) return;
  doc.documentElement.classList.add('ctrlem-rg-embed');
  const style = doc.createElement('style'); style.id = 'ctrlem-rg-cleanup';
  style.textContent = `${hiddenEmbedSelectors.map(selector => `html.ctrlem-rg-embed ${selector}`).join(',\n')} {
    display: none !important; visibility: hidden !important; pointer-events: none !important;
  }`;
  (doc.head || doc.documentElement).append(style);
}
