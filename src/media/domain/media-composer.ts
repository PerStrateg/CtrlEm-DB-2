import { z } from '../../shared/validation';
import { mediaRecipientSchema } from './media-settings';

export const mediaComposerPreferencesSchema = z.object({
  selectedRecipients: z.array(mediaRecipientSchema),
  imageCategoryId: z.string().min(1).optional(),
  videoCategoryId: z.string().min(1).optional(),
}).strict().refine(value => new Set(value.selectedRecipients.map(item => item.receiver)).size === value.selectedRecipients.length);
export type MediaComposerPreferences = z.infer<typeof mediaComposerPreferencesSchema>;

export const defaultMediaComposerPreferences = (): MediaComposerPreferences => ({
  selectedRecipients: [{ receiver: 'group:912b55df-0678-46bc-a5c3-b0d39a803740', kind: 'group', label: 'test' }],
});

export const recipientSearchSchema = z.object({
  kind: z.enum(['group', 'user']), query: z.string().max(120),
}).strict();
