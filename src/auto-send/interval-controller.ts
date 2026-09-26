import { autoSendLimits } from '../model/auto-send';
import type { AutoCommandKey } from '../model/auto-send';
import type { IntervalClient, Intervals } from '../shared/interval-protocol';
import type { AutoSendControl } from '../ui/auto-send';

interface Field {
  control: AutoSendControl; dirty: boolean; version: number; work?: Promise<boolean>; cleanup(): void;
}
/** Persistent preferences are independent from session tasks and their immutable intervals. */
export class IntervalController {
  private values: Intervals = {};
  private readonly fields = new Map<AutoCommandKey, Field>();
  private loaded = false;
  private disposed = false;
  private unsubscribe?: () => void;
  private revision = 0;
  constructor(private readonly client: IntervalClient) {}
  start(): void {
    this.unsubscribe = this.client.subscribe(values => {
      this.revision++; this.values = values;
      for (const [key, field] of this.fields) if (!field.dirty) field.control.preferred(values[key] ?? autoSendLimits.defaultSeconds);
    });
    void this.load();
  }
  private async load(): Promise<void> {
    const revision = this.revision;
    for (const field of this.fields.values()) field.control.preferenceStatus('Loading interval…', false);
    try {
      const values = await this.client.load(); if (this.disposed) return;
      if (revision === this.revision) this.values = values;
      this.loaded = true;
      for (const [key, field] of this.fields) {
        if (!field.dirty) field.control.preferred(this.values[key] ?? autoSendLimits.defaultSeconds);
        field.control.preferenceStatus('', true);
      }
    } catch {
      if (!this.disposed) for (const field of this.fields.values()) field.control.preferenceStatus('Couldn’t load interval.', false, () => { void this.load(); });
    }
  }
  register(key: AutoCommandKey, control: AutoSendControl): void {
    const input = () => { field.dirty = true; field.version++; control.preferenceStatus('', this.loaded); };
    const change = () => { if (control.interval.validity.valid) void this.flush(key); };
    const blur = () => { if (field.dirty) change(); else control.preferred(this.values[key] ?? autoSendLimits.defaultSeconds); };
    const field: Field = { control, dirty: false, version: 0, cleanup: () => {
      control.interval.removeEventListener('input', input); control.interval.removeEventListener('change', change); control.interval.removeEventListener('blur', blur);
    } };
    this.fields.set(key, field);
    control.interval.addEventListener('input', input); control.interval.addEventListener('change', change); control.interval.addEventListener('blur', blur);
    if (this.loaded) control.preferred(this.values[key] ?? autoSendLimits.defaultSeconds);
    control.preferenceStatus(this.loaded ? '' : 'Loading interval…', this.loaded);
  }
  async flush(key: AutoCommandKey): Promise<boolean> {
    const field = this.fields.get(key)!;
    if (!this.loaded || !field.control.interval.reportValidity()) return false;
    if (field.work) { const saved = await field.work; return saved && field.dirty ? this.flush(key) : saved; }
    if (!field.dirty) return true;
    const version = field.version, seconds = field.control.interval.valueAsNumber;
    field.control.preferenceStatus('', true);
    field.work = this.client.save(key, seconds).then(() => {
      if (this.disposed) return false;
      this.values[key] = seconds;
      if (version === field.version) { field.dirty = false; field.control.preferred(seconds); field.control.preferenceStatus('', true); }
      return true;
    }, () => {
      if (!this.disposed && version === field.version) field.control.preferenceStatus('', true);
      return false;
    });
    const saved = await field.work; field.work = undefined;
    return saved && field.dirty ? this.flush(key) : saved;
  }
  dispose(): void { this.disposed = true; this.unsubscribe?.(); for (const field of this.fields.values()) field.cleanup(); }
}
