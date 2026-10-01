import { mediaRecipientSchema, mediaSettingsSchema } from '../media/domain/media-settings';
import { mediaComposerPreferencesSchema, recipientSearchSchema } from '../media/domain/media-composer';
import { recipientProfileLimits } from '../media/domain/recipient-profile';
import { z } from './validation';

export const mediaSettingsLimits = { profileHtmlCharacters: recipientProfileLimits.maxBytes } as const;

export const mediaProfileHtmlRequestSchema = z.object({
  type: z.literal('media-settings:profile-html'), code: z.string().max(recipientProfileLimits.codeCharacters).regex(recipientProfileLimits.codePattern),
}).strict();
export const mediaSettingsRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('media-settings:access-get') }).strict(),
  z.object({ type: z.literal('media-settings:open-options') }).strict(),
  z.object({ type: z.literal('media-settings:get') }).strict(),
  z.object({ type: z.literal('media-settings:save'), settings: mediaSettingsSchema }).strict(),
  z.object({ type: z.literal('media-settings:composer-get') }).strict(),
  z.object({ type: z.literal('media-settings:composer-save'), preferences: mediaComposerPreferencesSchema }).strict(),
  z.object({ type: z.literal('media-settings:recipients'), search: recipientSearchSchema }).strict(),
  mediaProfileHtmlRequestSchema,
]);
export const mediaSettingsChangedSchema = z.object({
  type: z.literal('media-settings:changed'), settings: mediaSettingsSchema,
}).strict();
export const mediaRecipientsSchema = z.array(mediaRecipientSchema);
export const mediaComposerChangedSchema = z.object({
  type: z.literal('media-settings:composer-changed'), preferences: mediaComposerPreferencesSchema,
}).strict();
export const mediaProfileHtmlSchema = z.string().max(mediaSettingsLimits.profileHtmlCharacters);
export const mediaAccessChangedSchema = z.object({ type: z.literal('media-settings:access-changed'), granted: z.boolean() }).strict();
