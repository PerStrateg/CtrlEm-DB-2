import { z } from './validation';
import { mediaResourceSchema } from './media-send-protocol';

export const remoteMediaUploadPort = 'media-library-upload';
export const mediaCategoriesRequestSchema = z.object({ type: z.literal('media-library:categories'), kind: z.enum(['image', 'video']) }).strict();
export const remoteMediaSaveSchema = z.object({ type: z.literal('save'), resource: mediaResourceSchema, categoryId: z.string().uuid() }).strict();
