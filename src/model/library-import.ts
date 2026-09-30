import { libraryFileSchema } from './library-file';
import type { LibraryFile } from './library-file';

export class LibraryImportError extends Error {}

/** Validates a CtrlEm DB version 3 file before preview or persistence. */
export function readLibraryImport(input: unknown): LibraryFile {
  const parsed = libraryFileSchema.safeParse(input);
  if (!parsed.success) throw new LibraryImportError('Invalid library file. Choose a CtrlEm DB version 3 export.');
  return parsed.data;
}
