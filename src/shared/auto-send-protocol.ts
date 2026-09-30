import { z } from './validation';
import { autoCommandKeys, autoSendLimits } from '../model/auto-send';
import type { AutoCommandKey, AutoState } from '../model/auto-send';
import type { Item } from '../model/library';
import type { SendCommand } from '../model/send-command';

export const sendCommandSchema = z.object({ key: z.string().min(1), label: z.string(),
  fields: z.array(z.object({ id: z.string().min(1), value: z.string(), checked: z.boolean().optional() }).strict()),
  device: z.string().optional(), mode: z.string().optional() }).strict();

export const autoRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auto:snapshot') }).strict(),
  z.object({ type: z.literal('auto:start'), command: z.enum(autoCommandKeys),
    source: z.literal('files').optional(),
    parameters: sendCommandSchema.optional(),
    categoryId: z.union([z.string().uuid(), z.literal('default')]).optional(), itemId: z.string().min(1).optional(),
    intervalSeconds: z.number().int().min(autoSendLimits.minSeconds).max(autoSendLimits.maxSeconds) }).strict(),
  z.object({ type: z.literal('auto:stop'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('auto:seek'), taskId: z.string().uuid(),
    source: z.literal('files').optional(), categoryId: z.union([z.string().uuid(), z.literal('default')]).optional(), itemId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('auto:stop-all') }).strict(),
  z.object({ type: z.literal('auto:resume'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('auto:open'), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal('auto:manual') }).strict(),
  z.object({ type: z.literal('auto:enqueue'), id: z.string().uuid(), createdAt: z.number().int().nonnegative(), parameters: sendCommandSchema,
    source: z.literal('files').optional(), fileId: z.string().optional() }).strict(),
  z.object({ type: z.literal('auto:dismiss'), id: z.string().uuid() }).strict(),
]);
export type AutoRequest = z.infer<typeof autoRequestSchema>;
export class AutoConnectionError extends Error {}
export interface AutoPageState {
  receiver: string; commands: AutoCommandKey[]; galleries: Partial<Record<AutoCommandKey, Item[]>>;
}
export interface AutoSnapshot extends Omit<AutoState, 'acceptedRequests'> { readyReceivers: string[] }
export interface AutoClient {
  request(request: AutoRequest): Promise<AutoSnapshot>;
  subscribe(changed: (snapshot: AutoSnapshot | undefined) => void): () => void;
}
