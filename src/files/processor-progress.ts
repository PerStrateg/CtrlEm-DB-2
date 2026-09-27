import type { IMagickImageCollection } from '@imagemagick/magick-wasm';
import { filesPolicy, type ImagePreparationProgress } from '../model/files';

export function observeEncodingProgress(images: IMagickImageCollection, attempt: number, report: (progress: ImagePreparationProgress) => void): void {
  // One frame has no measurable intermediate frame count. Keep its active pulse.
  if (images.length === 1) return;
  // A full monitor reports millions of individual pixels during GIF dithering.
  // Observe only the start of each frame, then detach its native callback.
  let completed = 0;
  for (const [index, image] of images.entries()) image.onProgress = () => {
    image.onProgress = undefined;
    completed = Math.max(completed, index);
    report({ phase: 'encoding', attempt, percent: Math.floor(completed * 100 / images.length), frame: index + 1, frames: images.length });
    return 0;
  };
}

/** Progress never competes with pixel work by sending every codec callback. */
export function throttlePreparationProgress(send: (progress: ImagePreparationProgress) => void, now = () => performance.now()): (progress: ImagePreparationProgress) => void {
  let lastAt = -Infinity;
  return progress => {
    const time = now();
    if (progress.percent !== undefined && time - lastAt < filesPolicy.progressIntervalMs) return;
    lastAt = time; send(progress);
  };
}
