import type { AutoOutcome, SendFailureCode } from '../model/auto-send';

// Only known command messages can decide a send. Other site actions share the toast container.
const required: Record<string, string> = {
  openPage: 'Enter a URL', popupImage: 'Enter an image URL', changeWallpaper: 'Enter an image URL',
  discordWallpaper: 'Enter an image URL', sendMessage: 'Enter a message', popupSound: 'Upload or paste an audio URL',
  videoOverlay: 'Enter a video URL', writeForMe: 'Enter text',
};
const urlCommands = new Set(['openPage', 'popupImage', 'changeWallpaper', 'discordWallpaper', 'popupSound', 'videoOverlay', 'reactionTest']);
const invalid = (failureCode: SendFailureCode): AutoOutcome => ({ status: 'paused', reason: 'invalid', failureCode });

export function commandRejection(command: string, message: string, inline = false): AutoOutcome | undefined {
  if (message === 'Please wait before sending another command' ||
      (inline && /^Please wait \d+ seconds?\.?$/i.test(message))) {
    const seconds = /^Please wait (\d+) seconds?/i.exec(message)?.[1];
    return { status: 'paused', reason: 'failed', failureCode: 'rateLimit',
      ...(seconds ? { retryAfterMs: Number(seconds) * 1000 } : {}) };
  }
  if (message === required[command]) return invalid('required');
  if (urlCommands.has(command) && message === 'Please enter a valid URL (must start with http:// or https://)') return invalid('url');
  if (command === 'writeForMe' && message === 'Text must be 200 characters or less') return invalid('textLength');
  if (command === 'writeForMe' && message === 'Count must be between 1 and 5') return invalid('count');
  if (command === 'session' && message === 'Session already in progress') return invalid('session');
  // Even an inline transport failure does not prove that the command was rejected.
  if ((inline && /network|failed to fetch|load failed|timed? ?out/i.test(message)) ||
      /^(?:NetworkError when attempting to fetch resource\.?|(?:TypeError: )?Failed to fetch|Load failed|(?:The )?(?:request |operation )?timed? ?out\.?)$/i.test(message) ||
      /^Failed to send (?:command|Lovense command|PiShock command|OpenShock command|session request)$/.test(message)) {
    return { status: 'paused', reason: 'unknown' };
  }
  // Unknown inline errors are not proof of rejection either.
  return inline ? { status: 'paused', reason: 'unknown' } : undefined;
}

export function commandAcknowledged(command: string, text: string, group: boolean): boolean {
  if (group) return /^(?:Command sent|Sent) to \d+ online members?!$/.test(text);
  if (command === 'lovense') return text === 'Lovense vibrate sent';
  if (command === 'pishock') return /^(?:Shock|Vibrate|Beep) sent$/.test(text);
  if (command === 'openshock') return /^OpenShock (?:Shock|Vibrate|Beep) sent$/.test(text);
  return text === 'Command sent';
}
