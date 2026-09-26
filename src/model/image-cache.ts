export const imageCacheAccess = { origins: ['http://*/*', 'https://*/*'] };
export const imageCacheLimits = [256, 512, 1024, 2048, 5120, 10240] as const;
export const imageCacheDefaultBytes = 1024 ** 3;
export const imageCacheConcurrency = 4;
export const imageCacheDownloadTimeoutMs = 60_000;
export interface ImageCacheStats { bytes: number; count: number; limit: number }
export interface ImageCacheStatus extends ImageCacheStats { access: boolean; writeFailed: boolean }
