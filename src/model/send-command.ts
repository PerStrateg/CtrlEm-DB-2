/** Serializable UI state. No endpoint, script or arbitrary selector crosses the protocol. */
export interface SendField { id: string; value: string; checked?: boolean }
export interface SendCommand {
  key: string;
  label: string;
  fields: SendField[];
  device?: string;
  mode?: string;
}
export const sendQueueLimits = { userMs: 3_000, groupMs: 10_000, retryMaxMs: 60_000, readinessPollMs: 1_000,
  maxRetries: 3, requestWindowMs: 60_000 };
export function receiverFromUrl(value: string): string {
  const url = new URL(value);
  const match = /^\/(u|groups)\/([^/]+)\/?$/.exec(url.pathname);
  return url.origin === 'https://ctrlem.com' && match ? (match[1] === 'groups' ? 'group:' : '') + match[2]!.toLowerCase() : '';
}
export const receiverUrl = (receiver: string): string => receiver.startsWith('group:')
  ? `https://ctrlem.com/groups/${encodeURIComponent(receiver.slice(6))}` : `https://ctrlem.com/u/${encodeURIComponent(receiver)}`;
export const receiverLabel = (receiver: string): string => receiver.startsWith('group:') ? `Group ${receiver.slice(6)}` : receiver.toUpperCase();
