import { z } from './validation';
import { imageCacheLimits } from '../model/image-cache';
export { imageCacheAccess, imageCacheLimits } from '../model/image-cache';
export type { ImageCacheStats, ImageCacheStatus } from '../model/image-cache';
export const imageCacheChunkBytes = 256 * 1024;
export const imageCachePort = 'ctrlem-image-cache';
export const imageCacheUrl = z.string().url().refine(value => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
});
export const imageCacheSettingsRequest = z.discriminatedUnion('type', [
  z.object({ type: z.literal('image-cache:status') }).strict(),
  z.object({ type: z.literal('image-cache:clear') }).strict(),
  z.object({ type: z.literal('image-cache:limit'), bytes: z.number().refine(value =>
    imageCacheLimits.some(mib => mib * 1024 ** 2 === value)) }).strict(),
]);
export type ImageCacheSettingsRequest = z.infer<typeof imageCacheSettingsRequest>;
export type ImageCacheReply = { type: 'chunk'; data: string } | { type: 'done'; mime: string } | { type: 'direct' };
