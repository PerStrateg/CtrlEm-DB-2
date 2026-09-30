import type { ContentType } from './library';

export const commandKeys = ['openPage', 'sendMessage', 'writeForMe', 'popupImage', 'changeWallpaper', 'popupSound', 'videoOverlay'] as const;
export type CommandKey = typeof commandKeys[number];
export const writeForMeLimits = { textCharacters: 200, minCount: 1, maxCount: 5 } as const;
export const commands: Record<CommandKey, { type: ContentType; label: string; fieldId: string }> = {
  openPage: { type: 'link', label: 'Open Page', fieldId: 'val-openPage' },
  sendMessage: { type: 'text', label: 'Send Message', fieldId: 'val-sendMessage' },
  writeForMe: { type: 'text', label: 'Write For Me', fieldId: 'val-writeForMe-text' },
  popupImage: { type: 'image', label: 'Popup Image', fieldId: 'val-popupImage' },
  changeWallpaper: { type: 'image', label: 'Change Wallpaper', fieldId: 'val-changeWallpaper' },
  popupSound: { type: 'sound', label: 'Popup Sound', fieldId: 'val-popupSound' },
  videoOverlay: { type: 'video', label: 'Video Overlay', fieldId: 'val-videoOverlay' },
};
