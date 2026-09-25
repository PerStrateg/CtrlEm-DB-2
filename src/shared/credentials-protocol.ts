import { z } from './validation';

export const credentialFields = [
  { id: 'imgbb', label: 'ImgBB API key', description: 'Required to upload images to ImgBB.' },
  { id: 'catbox', label: 'Catbox userhash', description: 'Optional. Associate sound and video uploads with your Catbox account.' },
] as const;
export type CredentialId = typeof credentialFields[number]['id'];
export const credentialsRequest = z.discriminatedUnion('type', [
  z.object({ type: z.literal('credentials:load') }).strict(),
  z.object({ type: z.literal('credentials:save'), field: z.enum(['imgbb', 'catbox']), value: z.string() }).strict(),
]);
export type CredentialsRequest = z.infer<typeof credentialsRequest>;
export type Credentials = Record<CredentialId, string>;

export function authorizedSettings(sender: chrome.runtime.MessageSender, extensionId: string, settingsUrl: string): boolean {
  return sender.id === extensionId && sender.url === settingsUrl;
}
