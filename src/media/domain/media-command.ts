import type { CommandKey } from '../../model/commands';
import type { MediaAction } from './media-resource';

export const mediaCommandByAction: Record<MediaAction, CommandKey> = {
  'popup-image': 'popupImage',
  wallpaper: 'changeWallpaper',
  'video-overlay': 'videoOverlay',
};
