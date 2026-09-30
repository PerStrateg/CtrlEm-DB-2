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
  action: { default_title: 'CtrlEm', default_popup: 'popup.html' },
  permissions: ['storage', 'webRequest', 'alarms', 'unlimitedStorage', 'cookies', 'declarativeNetRequest'],
  host_permissions: ['http://*/*', 'https://*/*'],
  options_ui: { page: 'settings.html', open_in_tab: true },
  web_accessible_resources: [{ resources: ['settings.html', 'preview.html'], matches: ['https://ctrlem.com/*'] }],
  content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
  declarative_net_request: { rule_resources: [{ id: 'redgifs_embed', enabled: true, path: 'redgifs-rules.json' }] },
  content_scripts: [{
    matches: ['https://ctrlem.com/u/*', 'https://ctrlem.com/groups/*'],
    js: ['content.js'],
    css: ['content.css'],
    run_at: 'document_idle',
  }, { matches: ['http://*/*', 'https://*/*'], exclude_matches: ['https://ctrlem.com/*'], js: ['media-content.js'], css: ['media-content.css'], run_at: 'document_idle' },
  { matches: ['https://redgifs.com/*', 'https://www.redgifs.com/*'], js: ['redgifs-feed.js'], all_frames: true, run_at: 'document_start', world: 'MAIN' },
  { matches: ['https://redgifs.com/*', 'https://*.redgifs.com/*'], js: ['redgifs-storage.js'], all_frames: true, run_at: 'document_start' },
  { matches: ['https://redgifs.com/*', 'https://www.redgifs.com/*'], js: ['redgifs-frame.js'], all_frames: true, run_at: 'document_idle' }],
};

export const manifests = {
  'chrome-mv3': {
    ...common,
    permissions: [...common.permissions, 'offscreen'],
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
