import { emptyAutoState } from '../model/auto-send';
import type { AutoState } from '../model/auto-send';
import type { StorageArea } from './library-store';

const autoStateKey = 'ctrlem.auto-send';
/** Session-only, owned by background; no task is exported with the library. */
export class AutoSendRepository {
  constructor(private readonly storage: StorageArea) {}
  async read(): Promise<AutoState> {
    return (await this.storage.get(autoStateKey))[autoStateKey] as AutoState | undefined ?? emptyAutoState();
  }
  save(state: AutoState): Promise<void> { return this.storage.set({ [autoStateKey]: state }); }
}
