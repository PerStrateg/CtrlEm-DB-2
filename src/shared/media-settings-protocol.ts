import { mediaRecipientSchema, mediaSettingsSchema } from '../media/domain/media-settings';
import { mediaComposerPreferencesSchema, recipientSearchSchema } from '../media/domain/media-composer';
import { z } from './validation';

export const mediaSettingsRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('media-settings:get') }).strict(),
  z.object({ type: z.literal('media-settings:save'), settings: mediaSettingsSchema }).strict(),
  z.object({ type: z.literal('media-settings:composer-get') }).strict(),
  z.object({ type: z.literal('media-settings:composer-save'), preferences: mediaComposerPreferencesSchema }).strict(),
  z.object({ type: z.literal('media-settings:recipients'), search: recipientSearchSchema }).strict(),
]);
export const mediaSettingsChangedSchema = z.object({
  type: z.literal('media-settings:changed'), settings: mediaSettingsSchema,
}).strict();
export const mediaRecipientsSchema = z.array(mediaRecipientSchema);
