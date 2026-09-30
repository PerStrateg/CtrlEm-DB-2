import { ImageMagick, initializeImageMagick, MagickFormat, MagickReadSettings, QuantizeSettings } from '@imagemagick/magick-wasm';
import { filesPolicy, type ImagePreparationProgress } from '../model/files';
import { observeEncodingProgress, throttlePreparationProgress } from './processor-progress';

let initialized: Promise<void> | undefined;
const initialize = () => initialized ??= fetch(new URL('magick.wasm', location.href))
  .then(response => response.arrayBuffer()).then(bytes => initializeImageMagick(new Uint8Array(bytes)));
const asBlob = (data: Uint8Array, type: string) => new Blob([new Uint8Array(data)], { type });

async function thumbnail(blob: Blob): Promise<Blob> {
  // Browser decoding avoids loading WASM for common preview formats; TIFF needs ImageMagick.
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/avif'].includes(blob.type)) {
    const bitmap = await createImageBitmap(blob, { resizeWidth: filesPolicy.thumbnailSize, resizeQuality: 'high' });
    try {
      const scale = Math.min(1, filesPolicy.thumbnailSize / Math.max(bitmap.width, bitmap.height));
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
    } finally { bitmap.close(); }
  }
  await initialize();
  const settings = new MagickReadSettings(); settings.frameCount = 1;
  return ImageMagick.read(new Uint8Array(await blob.arrayBuffer()), settings, image => {
    image.autoOrient(); image.resize(filesPolicy.thumbnailSize, filesPolicy.thumbnailSize);
    return image.write(MagickFormat.WebP, data => asBlob(data, 'image/webp'));
  });
}

/** One reduction step. Only scale and palette shrink a lossless format; quality only bites in lossy ones. */
interface Reduction { scale: number; quality: number; colors: number }

/** Least reduction first, and never a full-size encode whose quality setting cannot change the output. */
function reductions(qualityMatters: boolean): Reduction[] {
  const palette = filesPolicy.paletteSteps.map(colors => ({ scale: 1, quality: 100, colors }));
  const quality = qualityMatters ? filesPolicy.qualitySteps.map(value => ({ scale: 1, quality: value, colors: 256 })) : [];
  const resize = Array.from({ length: filesPolicy.maxResizeSteps }, (_, index) =>
    ({ scale: filesPolicy.resizeFactor ** (index + 1), quality: 100, colors: 64 }));
  return [...palette, ...quality, ...resize];
}

export async function prepareImage(blob: Blob, progress?: (value: ImagePreparationProgress) => void): Promise<Blob> {
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(blob.type) && blob.size <= filesPolicy.maxUploadBytes) return blob;
  progress?.({ phase: 'decoding' });
  await initialize();
  return ImageMagick.readCollection(new Uint8Array(await blob.arrayBuffer()), images => {
    const gif = images[0]!.format === MagickFormat.Gif;
    const animated = images.length > 1;
    const format = gif ? MagickFormat.Gif : animated ? MagickFormat.WebP :
      images[0]!.format === MagickFormat.Jpeg ? MagickFormat.Jpeg : images[0]!.format === MagickFormat.Png ? MagickFormat.Png : MagickFormat.WebP;
    const mime = format === MagickFormat.Gif ? 'image/gif' : format === MagickFormat.Jpeg ? 'image/jpeg' : format === MagickFormat.Png ? 'image/png' : 'image/webp';
    if (animated) { progress?.({ phase: 'frames' }); images.coalesce(); }
    for (const image of images) { image.autoOrient(); image.strip(); }
    // A lossless encode ignores quality, so paying for a second full-size pass would repeat identical bytes.
    const qualityMatters = format === MagickFormat.Jpeg || format === MagickFormat.WebP;
    for (const [index, attempt] of reductions(qualityMatters).entries()) {
      const pass = index + 1;
      const result = images.clone(copy => {
        if (attempt.scale < 1) progress?.({ phase: 'resizing', attempt: pass });
        for (const [frame, image] of copy.entries()) {
          image.quality = attempt.quality;
          if (attempt.scale < 1) {
            image.resize(Math.max(1, Math.round(image.width * attempt.scale)), Math.max(1, Math.round(image.height * attempt.scale)));
            progress?.({ phase: 'resizing', attempt: pass, percent: Math.floor((frame + 1) * 100 / copy.length), frame: frame + 1, frames: copy.length });
          }
        }
        if (attempt.scale < 1) copy.resetPage();
        if (format === MagickFormat.Png || attempt.colors < 256) {
          progress?.({ phase: 'palette', attempt: pass });
          const quantize = new QuantizeSettings(); quantize.colors = attempt.colors; copy.quantize(quantize);
        }
        if (gif && animated) {
          progress?.({ phase: 'optimizing', attempt: pass }); copy.optimize(); copy.optimizeTransparency();
        }
        progress?.({ phase: 'encoding', attempt: pass });
        if (progress) observeEncodingProgress(copy, pass, progress);
        const encoded = copy.write(format, data => asBlob(data, mime));
        progress?.({ phase: 'encoding', attempt: pass, percent: 100 });
        return encoded;
      });
      if (result.size <= filesPolicy.maxUploadBytes) return result;
    }
    throw new Error('Could not fit this image within 4.5 MB while preserving its animation.');
  });
}

self.onmessage = (event: MessageEvent<{ blob: Blob; part: 'preview' | 'prepared' }>) => {
  const progress = throttlePreparationProgress(value => self.postMessage({ type: 'progress', progress: value }));
  void (event.data.part === 'preview' ? thumbnail(event.data.blob) : prepareImage(event.data.blob, progress)).then(
    blob => self.postMessage({ blob }), error => self.postMessage({ error: error instanceof Error ? error.message : 'Image processing failed.' }));
};
