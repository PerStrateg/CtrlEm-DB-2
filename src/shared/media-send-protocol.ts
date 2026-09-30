import { z } from './validation';
import { mediaRecipientSchema } from '../media/domain/media-settings';

export const mediaProtocolLimits = { idCharacters: 8_200, urlCharacters: 8_192 } as const;

export const mediaResourceSchema = z.object({
  id: z.string().min(1).max(mediaProtocolLimits.idCharacters),
  kind: z.enum(['image', 'video']),
  url: z.string().max(mediaProtocolLimits.urlCharacters).refine(value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } }),
}).strict();

export const mediaActionSchema = z.enum(['popup-image', 'wallpaper', 'video-overlay']);
const mediaIntentSchema = z.object({ resource: mediaResourceSchema, action: mediaActionSchema }).strict()
  .refine(({ resource, action }) => resource.kind === 'image' ? action !== 'video-overlay' : action === 'video-overlay');

export const mediaSendRequestSchema = mediaIntentSchema.extend({ type: z.literal('media-send:enqueue'),
  recipients: z.array(mediaRecipientSchema).min(1).refine(recipients => new Set(recipients.map(item => item.receiver)).size === recipients.length),
}).strict();
