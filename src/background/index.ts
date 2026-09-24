// Register background handlers synchronously so event-page/worker wakeups are safe.
// Storage writers and task scheduling will be added with their owning features.
chrome.runtime.onInstalled.addListener(() => {
  console.info('[CtrlEm DB] Extension installed.', chrome.runtime.getManifest().version);
});
