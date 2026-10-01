import type { AutoState } from '../../model/auto-send';
import { localImageSource } from './prepared-image';

/** Queue values and preparation sources survive worker sleep and protect in-flight files. */
export function protectedUploadSources(state: AutoState): Set<string> {
  const sources = new Set<string>();
  for (const entry of [...state.tasks, ...state.sends]) {
    for (const parameters of [entry.parameters, entry.execution?.parameters])
      for (const field of parameters?.fields ?? []) sources.add(field.value);
    if (entry.execution?.value) sources.add(entry.execution.value);
    if (entry.preparedItemId) sources.add(localImageSource(entry.preparedItemId));
    if ('fileId' in entry && entry.fileId) sources.add(localImageSource(entry.fileId));
    if ('retryExecution' in entry && entry.retryExecution) {
      if (entry.retryExecution.value) sources.add(entry.retryExecution.value);
      for (const field of entry.retryExecution.parameters?.fields ?? []) sources.add(field.value);
    }
  }
  return sources;
}
