import { z } from './validation';
import { mediaResourceSchema } from './media-send-protocol';

export const mediaLabelCharacters = 200;
export const remoteMediaUploadPort = 'media-library-upload';
export const mediaCategoriesRequestSchema = z.object({ type: z.literal('media-library:categories'), kind: z.enum(['image', 'video']) }).strict();
/** uploadedUrl resumes an already successful external upload, so a retry never uploads again. */
export const remoteMediaSaveSchema = z.object({ type: z.literal('save'), resource: mediaResourceSchema, categoryId: z.string().uuid(),
  uploadedUrl: z.url().optional(), uploadedLabel: z.string().max(mediaLabelCharacters).optional() }).strict();
