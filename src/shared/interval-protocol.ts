import { z } from './validation';
import { autoCommandKeys, autoSendLimits } from '../model/auto-send';
import type { AutoCommandKey } from '../model/auto-send';

export const intervalSecondsSchema = z.number().int().min(autoSendLimits.minSeconds).max(autoSendLimits.maxSeconds);
export const intervalsSchema = z.partialRecord(z.enum(autoCommandKeys), intervalSecondsSchema);
export type Intervals = z.infer<typeof intervalsSchema>;
export const intervalRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('interval:load') }).strict(),
  z.object({ type: z.literal('interval:save'), command: z.enum(autoCommandKeys), seconds: intervalSecondsSchema }).strict(),
]);
export interface IntervalClient {
  load(): Promise<Intervals>;
  save(command: AutoCommandKey, seconds: number): Promise<void>;
  subscribe(changed: (values: Intervals) => void): () => void;
}
export const intervalsKey = 'ctrlem.auto-send.intervals';
