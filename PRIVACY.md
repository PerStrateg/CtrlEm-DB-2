# Ctrlem DB privacy policy

Version 2.0.3 | Strateg | October 1, 2026

Ctrlem DB contains no analytics or telemetry and does not send user data to its developer. Your library and settings are stored locally in your browser profile. The extension does not use browser sync for this data.

## Local storage

The extension stores library entries, settings, provider keys, drafts, sending queue state, selected local files and cached media locally. Library export creates a local JSON file; it does not include provider keys or locally stored files. You choose whether to share an export.

Each CtrlEm tab also keeps a bounded diagnostic log in memory, reset when the page reloads. It records operation timings, file sizes and formats, error codes, filenames and media URLs involved in operations. Message text is replaced with asterisks. It does not store file bodies, full library exports, recipient IDs or provider credentials. Filenames and media URLs can contain personal information or private access links; review the file before sharing it. **Export log** creates a local file up to 5 MB; you choose whether to share it for support. Logs are never sent automatically.

## Requests needed for features

| Feature | Data and destination |
| --- | --- |
| CtrlEm Send and automatic sending | Selected text, media URLs, command parameters and recipient information go to CtrlEm through its authenticated command API. |
| Local Upload (LU) | Images are processed locally using bundled ImageMagick WASM. Selected images are then uploaded to CtrlEm. |
| ImgBB image uploads | Selected image files go to ImgBB, with your configured API key or a temporary token obtained from ImgBB for anonymous uploads. |
| Catbox audio uploads | Selected audio files go to Catbox, with your userhash if configured. |
| VidHosting video uploads | Selected video files go to VidHosting. |
| RedGifs | Embedded pages, searches, API calls and video playback contact RedGifs and its media hosts. The integration uses temporary API tokens and browser cookies, including copying RedGifs cookies into the CtrlEm storage partition for embedded access. |
| Save website media | A file you choose is downloaded without source cookies, then uploaded through the corresponding image/video provider and added to your local library. |
| Send website media | On HTTP/HTTPS pages, the extension identifies direct image and video URLs. Only a URL chosen with an I, W or V action is passed to CtrlEm through its authenticated command API. Page text, cookies and file bodies are not sent by this action. |
| Preview and cache | Media URLs in your library are requested from their hosts and CDNs for previews and local caching. Background cache requests omit credentials and the Referer header; embedded pages and ordinary browser media requests can use browser-managed cookies and referrers. |

Keys and other authorization data are sent to their corresponding providers. The developer does not receive them. Files, messages and authorization data can contain personal information. Services receiving requests also receive ordinary network metadata, such as your IP address. Their own privacy policies, tracking and retention practices apply. The extension cannot guarantee that third-party pages contain no analytics.

Deleting a local library entry or cache does not delete a file already uploaded to a provider. Use the provider's controls for remote deletion where available.

## Firefox data consent

Firefox declarations remain `authenticationInfo` and `personallyIdentifyingInfo`, because functional requests can transmit authorization data and selected personal content to services. These declarations do not indicate developer analytics. See [Mozilla's data consent documentation](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

## Permissions

- **storage / unlimitedStorage:** local library, settings, provider keys, selected files, cache and queue state.
- **alarms:** wake the background process for queued and automatic sending.
- **cookies / webRequest:** support RedGifs authentication and partitioned cookies when embedded in CtrlEm.
- **declarativeNetRequest:** embedding rules and selected advertising-request blocking. Existing rules remove CSP from CtrlEm pages and CSP/X-Frame-Options from embedded RedGifs responses.
- **Host access:** HTTP/HTTPS access lets the extension show I, W and V actions beside direct website media, operate CtrlEm and RedGifs integration, contact upload services and load selected library media.
- **wasm-unsafe-eval:** allows the bundled ImageMagick WASM to process images locally.

The existing RedGifs integration also hides its CookieYes consent interface. This behavior and response-header removal require separate review; hiding the interface does not prevent third-party data collection or establish consent.

## Your controls

Delete library entries and provider keys through the extension UI. Use Stop or Stop all to stop sending jobs. Export your library before uninstalling; browser removal can delete the extension's local storage. Library exports exclude provider keys and locally stored files.

## Project and support

[Ctrlem DB Discord channel](https://discord.com/channels/1465036592262676601/1505167683107160156) is the project and support page. A Discord account and server access may be required. Support messages contain only information you choose to send; the extension does not automatically send logs or diagnostic data.
