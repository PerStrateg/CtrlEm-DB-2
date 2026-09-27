export const filesPolicy = {
  maxUploadBytes: 4.5 * 1024 * 1024, capacity: 20, thumbnailSize: 256,
  cardSize: 128, gap: 10, overscanRows: 2, chunkBytes: 512 * 1024,
  processTimeoutMs: 5 * 60_000, progressIntervalMs: 100, qualitySteps: [90, 80, 65], paletteSteps: [256, 128, 64],
  resizeFactor: 0.8, maxResizeSteps: 12,
};
export const filesAccept = '.jpg,.jpeg,.png,.gif,.webp,.bmp,.avif,.tif,.tiff';
export type FilePart = 'original' | 'preview' | 'prepared';
export interface LocalImage {
  id: string; name: string; path: string; mime: string; size: number; order: number;
  uploadId?: string; animated?: boolean;
}
export interface FilesSnapshot { generation: string; items: LocalImage[]; previews: boolean; interval: number; selected?: string }
export interface NativeUpload { id: string; originalName: string; mimeType: string; fileSize: number; createdAt: string; url: string }
export interface FilesGallery { uploads: NativeUpload[]; error?: string }
export interface FileProgress {
  id: string;
  stage: 'preparing' | 'uploading';
  phase?: 'decoding' | 'frames' | 'resizing' | 'palette' | 'optimizing' | 'encoding' | 'storing';
  attempt?: number;
  frame?: number;
  frames?: number;
  percent?: number;
}
export interface FilesProgressSnapshot { revision: number; items: FileProgress[] }
export type ImagePreparationProgress = Pick<FileProgress, 'phase' | 'percent' | 'attempt' | 'frame' | 'frames'>;
export const initialFiles = (): FilesSnapshot => ({ generation: crypto.randomUUID(), items: [], previews: true, interval: 3 });
