import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const common = {
  manifest_version: 3,
  name: 'Ctrlem DB',
  version,
  description: 'A reusable content library for CtrlEm by Strateg.',
  author: 'Strateg',
  homepage_url: 'https://discord.com/channels/1465036592262676601/1505167683107160156',
  icons: Object.fromEntries([16, 32, 48, 64, 96, 128].map(size => [size, `icons/${size}.png`])),
  permissions: ['storage', 'webRequest', 'alarms', 'unlimitedStorage', 'cookies', 'declarativeNetRequest'],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  host_permissions: ['https://redgifs.com/*', 'https://*.redgifs.com/*', 'https://ctrlem.com/*', 'https://api.imgbb.com/*', 'https://imgbb.com/*', 'https://catbox.moe/*', 'https://upload.vidhosting.in/*'],
  options_ui: { page: 'settings.html', open_in_tab: true },
  web_accessible_resources: [{ resources: ['settings.html', 'preview.html', 'files-processor.html'], matches: ['https://ctrlem.com/*'] }],
  content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
  declarative_net_request: { rule_resources: [{ id: 'redgifs_embed', enabled: true, path: 'redgifs-rules.json' }] },
  content_scripts: [{
    matches: ['https://ctrlem.com/u/*', 'https://ctrlem.com/groups/*'],
    js: ['content.js'],
    css: ['content.css'],
    run_at: 'document_idle',
  }, { matches: ['https://redgifs.com/*', 'https://www.redgifs.com/*'], js: ['redgifs-feed.js'], all_frames: true, run_at: 'document_start', world: 'MAIN' },
  { matches: ['https://redgifs.com/*', 'https://*.redgifs.com/*'], js: ['redgifs-storage.js'], all_frames: true, run_at: 'document_start' },
  { matches: ['https://redgifs.com/*', 'https://www.redgifs.com/*'], js: ['redgifs-frame.js'], all_frames: true, run_at: 'document_idle' }],
};

export const manifests = {
  'chrome-mv3': {
    ...common,
    background: { service_worker: 'background.js' },
  },
  'firefox-mv3': {
    ...common,
    background: { scripts: ['background.js'] },
    browser_specific_settings: {
      gecko: {
        id: '@ctrlem-db.strateg',
        strict_min_version: '142.0',
        data_collection_permissions: { required: ['authenticationInfo', 'personallyIdentifyingInfo'] },
      },
    },
  },
};
