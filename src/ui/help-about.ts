/** User-facing instructions; no page state or provider credentials are read here. */
export function createHelpAbout(document: Document, version: string): HTMLElement {
  const section = document.createElement('section'); section.className = 'ctrlem-db-help';
  section.setAttribute('aria-label', 'Help & About');
  const intro = document.createElement('p');
  intro.textContent = 'Keep links, messages and media ready to use beside your CtrlEm commands.';
  section.append(intro);
  const started = document.createElement('details'); started.open = true;
  const summary = document.createElement('summary'); summary.textContent = 'Get started';
  const steps = document.createElement('ol');
  for (const copy of [
    'Open DB and choose Links, Text, Images, Sounds or Videos.',
    'Choose Create category, give it a name, then add one item per line. Changes save automatically.',
    'Beside a command, choose your category and an item. This fills the command’s field.',
    'Press Send when you are ready. Click DB again to return to Results.',
  ]) { const item = document.createElement('li'); item.textContent = copy; steps.append(item); }
  started.append(summary, steps); section.append(started);
  const topics: [string, string[]][] = [
    ['Writing and editing items', [
      'Use one message or web address per line. For media, you can add a name after the address, separated by a space: example.com/image.jpg My picture.',
      'You can leave out https://. Lines with errors stay in your draft; correct them to save. Use the arrows beside category names to change their order.',
    ]],
    ['Input and Default', [
      'Input collects new items you send manually. Items already in that library type are not added again.',
      'Default shows CtrlEm’s own images. They are separate from your saved categories. CtrlEm’s built-in upload controls remain available with Default.',
    ]],
    ['Preview and uploads', [
      'Preview opens media without selecting or sending it. Press Escape or Preview again to close it.',
      'Choose a category before uploading. Images use ImgBB, sounds use Catbox, and videos use VidHosting. Uploaded files are added to that category.',
      'Cancel removes an upload that has not started. Removing a result does not delete the file from the upload service. If an address remains visible, copy it before removing the result.',
    ]],
    ['Upload settings', [
      'Open Settings to connect an upload account. An API key or userhash is a code supplied by the upload service. These fields are optional; VidHosting needs no key.',
      'If uploads need permission, choose Enable Catbox access beside the uploader, then Allow Catbox uploads on the page that opens. Return to CtrlEm when done.',
    ]],
    ['Local Upload', [
      'LU opens local images. Drag images or folders into the orange area, or use Add files / Add folder. Choose an image, then use Send (single). A sends the images in order. JPG, PNG, GIF, WebP, BMP, AVIF and TIFF are supported; large images are resized when needed.',
      'Clear all removes the local list and cancels its queued tasks. Images already uploaded to CtrlEm remain there.',
    ]],
    ['RedGifs', [
      'RG opens the video browser inside Results. Choose a video and use its send action to add it to the queue.',
    ]],
    ['Auto-send and the queue', [
      'The number beside A is the time between sends in seconds, from 3 to 3600. A sends items from the selected category in order. Choose another item to change what goes next.',
      'Press A again or Stop in the queue to stop. Stop all stops the queue. For a paused task, follow its explanation and choose Resume when ready.',
      'Each command remembers its interval. Changing that setting does not change tasks already running. Site wait times and other queued commands can make a send take longer.',
    ]],
    ['When a send needs attention', [
      'Use the i button in a queue row to see its source and any problem. Open page takes you to a task’s CtrlEm page when it needs to reconnect.',
      'Unconfirmed means the site did not give a clear result. Check Results: the command may already have been sent. That attempt is not repeated automatically; auto-send continues with its next item. Stop cannot undo a command already sent to the site. Dismiss only clears the notice.',
    ]],
    ['Library backups', [
      'Settings → Export DB downloads your categories and items in version 3 format. Import DB accepts CtrlEm DB versions 3 and 1, and old userscript versions 1 and 2.',
      'New installations start with a bundled library. Settings → Restore Defaults previews that same library and replaces all your categories after confirmation. Export DB first to keep your current library. Settings, intervals and Local Upload files are kept.',
      'Review the import before choosing Replace DB. Replacement removes the current saved categories and stops their auto-send tasks. Export a backup first if you want to keep them. Upload account settings and intervals are kept.',
    ]],
    ['Image storage', [
      'Settings → Image storage keeps copies of viewed images on this device so they load faster next time. Older copies are removed when the storage limit is reached.',
      'Clear cache removes these copies. It does not delete library entries or files from upload services. Images can still display without this storage permission.',
    ]],
    ['Saved data and drafts', [
      'Your library and saved intervals remain after restarting the browser. Tasks and drafts belong to the current browser session. Reloading restores a draft already received by the extension; closing its tab removes that draft.',
      'If another tab changes the same category, choose Keep my version or Load latest. Account keys stay in the extension and are not included in library backups.',
    ]],
  ];
  for (const [heading, paragraphs] of topics) {
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = heading;
    details.append(summary);
    for (const copy of paragraphs) { const paragraph = document.createElement('p'); paragraph.textContent = copy; details.append(paragraph); }
    section.append(details);
  }
  const about = document.createElement('footer'); about.className = 'ctrlem-db-about';
  about.textContent = `Ctrlem DB · Version ${version} · By Strateg`; section.append(about);
  return section;
}
