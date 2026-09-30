import type { MediaAction } from './domain/media-resource';
import type { CommandKey } from '../model/commands';

export const mediaDestination = {
  receiver: 'group:912b55df-0678-46bc-a5c3-b0d39a803740',
} as const;

export const mediaCommandByAction: Record<MediaAction, CommandKey> = {
  'popup-image': 'popupImage',
  wallpaper: 'changeWallpaper',
  'video-overlay': 'videoOverlay',
};
