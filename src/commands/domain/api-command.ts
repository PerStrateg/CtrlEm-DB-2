import { autoCommandKeys, type AutoCommandKey, type AutoExecution, type SendFailureCode } from '../../model/auto-send';
import { commands } from '../../model/commands';

export const apiCommandKeys = autoCommandKeys;
export type ApiCommandKey = AutoCommandKey;

export type SerializedCommand = { ok: true; value: string } | { ok: false; failureCode: SendFailureCode };

const urlCommands = new Set<ApiCommandKey>(['openPage', 'popupImage', 'changeWallpaper', 'popupSound', 'videoOverlay']);
const writeCountFieldId = 'val-writeForMe-count';

function fieldValue(execution: AutoExecution, id: string): string | undefined {
  return execution.parameters?.fields.find(field => field.id === id)?.value;
}

function primaryValue(execution: AutoExecution, command: Exclude<ApiCommandKey, 'sendOrDelete'>): string {
  return (execution.value ?? fieldValue(execution, commands[command].fieldId) ?? '').trim();
}

function validUrl(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

export function apiCommandKey(value: string): ApiCommandKey | undefined {
  return apiCommandKeys.find(command => command === value);
}

export function serializeApiCommand(execution: AutoExecution): SerializedCommand {
  const command = apiCommandKey(execution.command);
  if (!command) return { ok: false, failureCode: 'rejected' };
  if (command === 'sendOrDelete') return { ok: true, value: command };

  const value = primaryValue(execution, command);
  if (!value) return { ok: false, failureCode: 'required' };
  if (urlCommands.has(command)) return validUrl(value)
    ? { ok: true, value: `${command} ${value}` }
    : { ok: false, failureCode: 'url' };
  if (command === 'sendMessage') return { ok: true, value: `${command} ${encodeURIComponent(value)}` };

  if (value.length > 200) return { ok: false, failureCode: 'textLength' };
  const count = Number(fieldValue(execution, writeCountFieldId));
  if (!Number.isInteger(count) || count < 1 || count > 5) return { ok: false, failureCode: 'count' };
  return { ok: true, value: `${command} ${encodeURIComponent(value)}|DELIM|${count}` };
}
