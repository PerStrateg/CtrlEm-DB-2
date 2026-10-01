export interface PreparedImage { blob: Blob; name: string }
export const localImageSource = (id: string): string => `file:${id}`;
