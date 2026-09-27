export interface ImportFile { file: File; path: string }

export function pickedFiles(files: Iterable<File>): ImportFile[] {
  return Array.from(files, file => ({ file, path: file.webkitRelativePath || file.name }));
}

async function readEntry(entry: FileSystemEntry, parent = ''): Promise<ImportFile[]> {
  const path = `${parent}${entry.name}`;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    return [{ file, path }];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const files: ImportFile[] = [];
  // A directory reader returns batches, including in folders with more than 100 entries.
  for (;;) {
    const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!entries.length) return files;
    for (const child of entries) files.push(...await readEntry(child, `${path}/`));
  }
}

export function droppedFiles(data: DataTransfer): Promise<ImportFile[]> {
  // Capture entries and Files during drop; the browser protects the transfer after the event.
  const sources = Array.from(data.items).filter(item => item.kind === 'file').map(item => ({
    entry: item.webkitGetAsEntry(), file: item.getAsFile(),
  }));
  return Promise.all(sources.map(({ entry, file }) => entry ? readEntry(entry) : Promise.resolve(file ? pickedFiles([file]) : [])))
    .then(batches => batches.flat());
}
