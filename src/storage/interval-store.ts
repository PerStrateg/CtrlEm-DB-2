import { intervalsKey, intervalsSchema } from '../shared/interval-protocol';
import type { Intervals } from '../shared/interval-protocol';
import type { AutoCommandKey } from '../model/auto-send';
import type { StorageArea } from './library-store';

/** The background serializes read-modify-write operations for all commands. */
export class IntervalRepository {
  constructor(private readonly storage: StorageArea) {}
  async read(): Promise<Intervals> {
    return intervalsSchema.parse((await this.storage.get(intervalsKey))[intervalsKey] ?? {});
  }
  async save(command: AutoCommandKey, seconds: number): Promise<void> {
    await this.storage.set({ [intervalsKey]: { ...await this.read(), [command]: seconds } });
  }
}
