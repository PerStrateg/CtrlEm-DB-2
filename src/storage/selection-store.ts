import { selectionsSchema } from '../shared/picker-protocol';
import type { PickerSelection, PickerSelections } from '../shared/picker-protocol';
import type { CommandKey } from '../model/commands';
import type { StorageArea } from './library-store';

const selectionKey = (receiver: string) => `ctrlem.selection.${receiver}`;

/** Read-modify-write is owned by the background service's write queue. */
export class SelectionRepository {
  constructor(private readonly storage: StorageArea) {}
  async read(receiver: string): Promise<PickerSelections> {
    const data = (await this.storage.get(selectionKey(receiver)))[selectionKey(receiver)];
    return data === undefined ? {} : selectionsSchema.parse(data);
  }
  async save(receiver: string, command: CommandKey, selection: PickerSelection): Promise<void> {
    const selections = await this.read(receiver);
    selections[command] = selection;
    await this.storage.set({ [selectionKey(receiver)]: selections });
  }
}
