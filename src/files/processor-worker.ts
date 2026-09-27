import { ImageMagick, initializeImageMagick, MagickFormat, MagickReadSettings, QuantizeSettings } from '@imagemagick/magick-wasm';
import { filesPolicy } from '../model/files';

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

export async function prepareImage(blob: Blob): Promise<Blob> {
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(blob.type) && blob.size <= filesPolicy.maxUploadBytes) return blob;
  await initialize();
  return ImageMagick.readCollection(new Uint8Array(await blob.arrayBuffer()), images => {
    const gif = images[0]!.format === MagickFormat.Gif;
    const animated = images.length > 1;
    const format = gif ? MagickFormat.Gif : animated ? MagickFormat.WebP :
      images[0]!.format === MagickFormat.Jpeg ? MagickFormat.Jpeg : images[0]!.format === MagickFormat.Png ? MagickFormat.Png : MagickFormat.WebP;
    const mime = format === MagickFormat.Gif ? 'image/gif' : format === MagickFormat.Jpeg ? 'image/jpeg' : format === MagickFormat.Png ? 'image/png' : 'image/webp';
    if (animated) images.coalesce();
    for (const image of images) { image.autoOrient(); image.strip(); }
    // GIF quality does not reduce its size. Only try a new palette after the lossless pass.
    const reductionSteps = gif ? filesPolicy.paletteSteps.filter(colors => colors < 256)
      .map(colors => ({ scale: 1, quality: 100, colors }))
      : filesPolicy.qualitySteps.map((quality, i) => ({ scale: 1, quality, colors: filesPolicy.paletteSteps[i]! }));
    const attempts = [{ scale: 1, quality: 100, colors: 256 }, ...reductionSteps,
      ...Array.from({ length: filesPolicy.maxResizeSteps }, (_, i) => ({ scale: filesPolicy.resizeFactor ** (i + 1), quality: 65, colors: 64 }))];
    for (const attempt of attempts) {
      const result = images.clone(copy => {
        for (const image of copy) {
          image.quality = attempt.quality;
          if (attempt.scale < 1) image.resize(Math.max(1, Math.round(image.width * attempt.scale)), Math.max(1, Math.round(image.height * attempt.scale)));
        }
        if (attempt.scale < 1) copy.resetPage();
        if ((gif || format === MagickFormat.Png) && attempt.colors < 256) {
          const quantize = new QuantizeSettings(); quantize.colors = attempt.colors; copy.quantize(quantize);
        }
        if (gif && animated) { copy.optimize(); copy.optimizeTransparency(); }
        return copy.write(format, data => asBlob(data, mime));
      });
      if (result.size <= filesPolicy.maxUploadBytes) return result;
    }
    throw new Error('Could not fit this image within 4.5 MB while preserving its animation.');
  });
}

self.onmessage = (event: MessageEvent<{ blob: Blob; part: 'preview' | 'prepared' }>) => {
  void (event.data.part === 'preview' ? thumbnail(event.data.blob) : prepareImage(event.data.blob)).then(
    blob => self.postMessage({ blob }), error => self.postMessage({ error: error instanceof Error ? error.message : 'Image processing failed.' }));
};
