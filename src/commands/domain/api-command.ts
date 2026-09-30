import { autoCommandKeys, type AutoCommandKey, type SendFailureCode } from '../../model/auto-send';
import { writeForMeLimits } from '../../model/commands';

export const apiCommandKeys = autoCommandKeys;
export type ApiCommandKey = AutoCommandKey;

export type SerializedCommand = { ok: true; value: string } | { ok: false; failureCode: SendFailureCode };

const urlCommands = new Set<ApiCommandKey>(['openPage', 'popupImage', 'changeWallpaper', 'popupSound', 'videoOverlay']);
export interface ApiCommand { command: string; value?: string; count?: number }

function validUrl(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

export function apiCommandKey(value: string): ApiCommandKey | undefined {
  return apiCommandKeys.find(command => command === value);
}

export function serializeApiCommand(execution: ApiCommand): SerializedCommand {
  const command = apiCommandKey(execution.command);
  if (!command) return { ok: false, failureCode: 'rejected' };
  if (command === 'sendOrDelete') return { ok: true, value: command };

  const value = (execution.value ?? '').trim();
  if (!value) return { ok: false, failureCode: 'required' };
  if (urlCommands.has(command)) return validUrl(value)
    ? { ok: true, value: `${command} ${value}` }
    : { ok: false, failureCode: 'url' };
  if (command === 'sendMessage') return { ok: true, value: `${command} ${encodeURIComponent(value)}` };

  if (value.length > writeForMeLimits.textCharacters) return { ok: false, failureCode: 'textLength' };
  const count = execution.count;
  if (count === undefined || !Number.isInteger(count) || count < writeForMeLimits.minCount || count > writeForMeLimits.maxCount) return { ok: false, failureCode: 'count' };
  return { ok: true, value: `${command} ${encodeURIComponent(value)}|DELIM|${count}` };
}
