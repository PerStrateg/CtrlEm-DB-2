import snapshot from '../data/default-library.json';
import { emptyLibrary } from './library';
import type { Library } from './library';
import { libraryFileSchema, planImport } from './library-file';

export const defaultLibraryFile = libraryFileSchema.parse(snapshot);

export function createDefaultLibrary(): Library {
  const library = emptyLibrary();
  return { ...library, revision: 1, categories: planImport(library, defaultLibraryFile, 'replace').categories };
}
