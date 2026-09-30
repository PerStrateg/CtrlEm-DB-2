import { z } from '../../shared/validation';

export const mediaSettingsLimits = {
  receiverCharacters: 128,
  labelCharacters: 120,
  hostnameCharacters: 253,
} as const;

export const mediaRecipientSchema = z.object({
  receiver: z.string().min(1).max(mediaSettingsLimits.receiverCharacters),
  kind: z.enum(['group', 'user']),
  label: z.string().min(1).max(mediaSettingsLimits.labelCharacters),
}).strict();
export type MediaRecipient = z.infer<typeof mediaRecipientSchema>;

const hostnameSchema = z.string().min(1).max(mediaSettingsLimits.hostnameCharacters)
  .transform(value => value.toLowerCase())
  .refine(value => { try { return new URL(`https://${value}`).hostname === value; } catch { return false; } });

export const mediaSettingsSchema = z.object({
  enabled: z.boolean(),
  showWallpaper: z.boolean(),
  selectedRecipients: z.array(mediaRecipientSchema),
  excludedHosts: z.array(hostnameSchema),
}).strict().refine(value => new Set(value.selectedRecipients.map(item => item.receiver)).size === value.selectedRecipients.length)
  .refine(value => new Set(value.excludedHosts).size === value.excludedHosts.length);
export type MediaSettings = z.infer<typeof mediaSettingsSchema>;

export const defaultMediaSettings = (): MediaSettings => ({
  enabled: true,
  showWallpaper: true,
  selectedRecipients: [{
    receiver: 'group:912b55df-0678-46bc-a5c3-b0d39a803740',
    kind: 'group',
    label: 'test',
  }],
  excludedHosts: [],
});

export function mediaEnabledOn(settings: MediaSettings, url: string): boolean {
  if (!settings.enabled) return false;
  try { return !settings.excludedHosts.includes(new URL(url).hostname.toLowerCase()); }
  catch { return false; }
}
