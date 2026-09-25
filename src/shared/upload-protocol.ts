import type { UploadFailure } from './upload-errors';
import { z } from './validation';
export const uploadPortName = 'ctrlem-upload';
export const uploadReadyRequest = z.object({ type: z.literal('upload:ready') }).strict();
export const uploadChunkBytes = 512 * 1024;
export const uploadKeepAliveMs = 20_000;
export const uploadTimeoutMs = 5 * 60_000;
export const uploadMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), provider: z.enum(['imgbb', 'catbox', 'vidhosting']), media: z.enum(['image', 'sound', 'video']),
    name: z.string(), mime: z.string(), size: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('chunk'), data: z.string().max(Math.ceil(uploadChunkBytes / 3) * 4) }).strict(),
  z.object({ type: z.literal('finish') }).strict(),
  z.object({ type: z.literal('ping') }).strict(),
]);
export type UploadMessage = z.infer<typeof uploadMessage>;
export type UploadReply = { ok: true; url?: string } | { ok: false; error: string; failure?: UploadFailure };
