export type UploadStage = 'settings' | 'page' | 'token' | 'upload' | 'response' | 'transfer';
export type UploadFailureCode = 'unavailable' | 'network' | 'http' | 'invalid-response' | 'interrupted' | 'file-read';
export interface UploadFailure { stage: UploadStage; code: UploadFailureCode; status?: number; anonymous?: boolean }

/** Only these application-owned diagnostics may cross the background boundary. */
export class UploadError extends Error {
  constructor(readonly failure: UploadFailure) {
    const stage = { settings: 'Settings', page: 'ImgBB page', token: 'ImgBB token', upload: 'Upload', response: 'Provider response', transfer: 'File transfer' }[failure.stage];
    const reason = { unavailable: 'unavailable', network: 'connection failed', http: `HTTP ${failure.status}`, 'invalid-response': 'invalid response', interrupted: 'interrupted', 'file-read': 'could not read file' }[failure.code];
    const help = failure.anonymous ? ' Uploading without a key is unavailable. Set up provider with your API key.' : '';
    const uncertain = ['upload', 'response', 'transfer'].includes(failure.stage) ? ' The provider may have received the file; retry only if needed.' : '';
    super(`${stage}: ${reason}.${help}${uncertain}`);
  }
}
