import type { ImagePreparationProgress } from '../model/files';
export interface ImagePreparationJob { id: string; part: 'preview' | 'prepared'; generation: string; token: string }

/** Sole codec channel. A port is scoped to the exact extension document, so no message handler can race it. */
export const imageProcessorPort = 'ctrlem-image-processor';

export type ImageProcessorCommand =
  | { type: 'image-processor:heartbeat' }
  | { type: 'image-processor:run'; job: ImagePreparationJob }
  | { type: 'image-processor:cancel'; token: string };

export type ImageProcessorNotice =
  | { type: 'image-processor:progress'; token: string; value: ImagePreparationProgress }
  | { type: 'image-processor:settled'; token: string; bytes?: number; error?: string };