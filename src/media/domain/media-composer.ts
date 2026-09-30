import { z } from '../../shared/validation';
import { mediaRecipientSchema } from './media-settings';

export const mediaComposerPreferencesSchema = z.object({
  selectedRecipients: z.array(mediaRecipientSchema),
  imageCategoryId: z.string().min(1).optional(),
  videoCategoryId: z.string().min(1).optional(),
}).strict().refine(value => new Set(value.selectedRecipients.map(item => item.receiver)).size === value.selectedRecipients.length);
export type MediaComposerPreferences = z.infer<typeof mediaComposerPreferencesSchema>;

/** No recipient ships as default: the first send must be an explicit human choice. */
export const defaultMediaComposerPreferences = (): MediaComposerPreferences => ({ selectedRecipients: [] });

export const recipientSearchSchema = z.object({
  kind: z.enum(['group', 'user']), query: z.string().max(120),
}).strict();
