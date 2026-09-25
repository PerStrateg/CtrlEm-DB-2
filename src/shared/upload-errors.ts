export type UploadStage = 'access' | 'settings' | 'page' | 'token' | 'upload' | 'response' | 'transfer';
export type UploadFailureCode = 'unavailable' | 'network' | 'http' | 'invalid-response' | 'interrupted' | 'file-read';
export interface UploadNetworkDiagnostic {
  observation: 'observed' | 'not-observed' | 'unavailable' | 'ambiguous';
  status?: number;
  redirected?: boolean;
  browserError?: string;
  hostPermission?: 'granted' | 'missing' | 'unknown';
  observerPermission?: 'granted' | 'missing' | 'unknown';
  originMissing?: boolean;
}
export interface UploadFailure { stage: UploadStage; code: UploadFailureCode; status?: number; anonymous?: boolean; network?: UploadNetworkDiagnostic }

/** Only these application-owned diagnostics may cross the background boundary. */
export class UploadError extends Error {
  constructor(readonly failure: UploadFailure) {
    const stage = { access: 'Catbox access', settings: 'Settings', page: 'ImgBB page', token: 'ImgBB token', upload: 'Upload', response: 'Provider response', transfer: 'File transfer' }[failure.stage];
    const reason = { unavailable: 'unavailable', network: 'connection failed', http: `HTTP ${failure.status}`, 'invalid-response': 'invalid response', interrupted: 'interrupted', 'file-read': 'could not read file' }[failure.code];
    const help = failure.stage === 'access' ? ' Enable Catbox access in provider settings. No file was sent.' : failure.anonymous ? ' Uploading without a key is unavailable. Set up provider with your API key.' : '';
    const uncertain = ['upload', 'response', 'transfer'].includes(failure.stage) ? ' The provider may have received the file; retry only if needed.' : '';
    const network = failure.network;
    const diagnostic = network ? ` Catbox diagnostic: ${[
      network.observation,
      network.status === undefined ? '' : `HTTP ${network.status}`,
      network.redirected ? 'redirect rejected' : '',
      network.browserError ?? '',
      network.hostPermission ? `Catbox access ${network.hostPermission}` : '',
      network.observerPermission ? `webRequest ${network.observerPermission}` : '',
      network.originMissing ? 'request origin unavailable' : '',
    ].filter(Boolean).join('; ')}.` : '';
    super(`${stage}: ${reason}.${diagnostic}${help}${uncertain}`);
  }
}
