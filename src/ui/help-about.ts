/** User-facing instructions; no page state or provider credentials are read here. */
export function createHelpAbout(document: Document, version: string): HTMLElement {
  const section = document.createElement('section'); section.className = 'ctrlem-db-help';
  section.setAttribute('aria-label', 'Help & About');
  const title = document.createElement('h3'); title.textContent = 'CtrlEm DB by Strateg';
  const release = document.createElement('p'); release.textContent = `Version ${version}`;
  section.append(title, release);
  const topics = [
    ['What is CtrlEm DB?', 'Keep reusable links, messages, images, sounds and videos in your own library. Pick an entry beside a CtrlEm command instead of finding and pasting it each time.'],
    ['Get started', 'Open DB → Categories. Choose a type, create a category and enter one item per line. Wait for Saved, then choose the category and an entry beside the command. The field is now ready; press Send when you want to send it. Click DB again to return to Results.'],
    ['Entries and labels', 'Text uses one message per line. Links use one web address per line. For images, sounds and videos, add an optional label after the address and a space. Addresses without a scheme are saved with https://. Invalid lines stay in your draft until you fix them.'],
    ['Input and Default', 'New manual values accepted into the send queue are added to Input once, unless already stored in that content type. Default uses CtrlEm’s own images and native image/audio upload controls; those images are not copied into your library.'],
    ['Preview and uploads', 'Preview shows media without selecting or sending it. Press Escape or Preview again to close it. Choose a local category before uploading with ImgBB, Catbox or VidHosting. Successful uploads are saved there. Cancel removes a waiting upload; Remove clears an error row. If an uploaded URL remains visible, you can copy it into a category in DB. Removing a result does not delete the provider’s file.'],
    ['Auto-send', 'The number beside A is the interval in seconds (3–3600). Each command remembers its own number for all recipients. A starts a cycle through the chosen category. Choose another entry to change the next item. Press A again or Stop in the queue to stop. Stop all stops the queue. Resume continues a paused task. Changing a saved interval in another tab does not change a running task.'],
    ['Sending and uncertainty', 'Send uses the shared queue, so site cooldowns and other commands can increase the wait. Stop cannot undo a click already sent to the site. Unconfirmed means the site did not provide a clear result: check Results. That attempt is not retried automatically; a recurring task continues to its next item.'],
    ['Backups and userscript import', 'Settings → Export DB saves all categories. Import DB accepts this extension’s export and the old CtrlEm DB userscript version 1 export. Review the categories and any skipped entries before Replace DB. Replacement removes the current saved categories and stops their auto-send tasks. Provider settings and saved intervals are kept. Export a backup first if you want to keep the previous library.'],
    ['Saved data and drafts', 'The library and command intervals remain after a browser restart. Tasks and drafts belong to the current browser session. Reload restores a confirmed draft; closing its tab removes that draft. Conflicting edits offer Keep my version or Load latest. Provider keys stay in the extension settings and are not included in library exports.'],
  ];
  for (const [heading, copy] of topics) {
    const details = document.createElement('details'); details.open = heading === 'What is CtrlEm DB?' || heading === 'Get started';
    const summary = document.createElement('summary'); summary.textContent = heading!;
    const paragraph = document.createElement('p'); paragraph.textContent = copy!;
    details.append(summary, paragraph); section.append(details);
  }
  return section;
}
