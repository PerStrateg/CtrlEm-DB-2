import { z } from './validation';
import { filesPolicy } from '../model/files';
export const filesPort = 'ctrlem-files';
const part = z.enum(['original', 'preview', 'prepared']);
export const filesRequest = z.discriminatedUnion('type', [
  z.object({ type: z.literal('files:list') }).strict(),
  z.object({ type: z.literal('files:gallery') }).strict(),
  z.object({ type: z.literal('files:clear') }).strict(),
  z.object({ type: z.literal('files:preferences'), previews: z.boolean().optional(), interval: z.number().int().min(3).max(3600).optional(), selected: z.string().optional() }).strict(),
]);
export const filesTransfer = z.discriminatedUnion('type', [
  z.object({ type: z.literal('get'), id: z.string(), part, token: z.string().optional() }).strict(),
  z.object({ type: z.literal('put'), generation: z.string(), id: z.string(), part, mime: z.string(), size: z.number().int().positive(),
    name: z.string().optional(), path: z.string().optional(), token: z.string().optional() }).strict(),
  z.object({ type: z.literal('chunk'), data: z.string().max(Math.ceil(filesPolicy.chunkBytes / 3) * 4) }).strict(),
  z.object({ type: z.literal('finish') }).strict(),
  z.object({ type: z.literal('ack') }).strict(),
]);
export type FileProcess = { type: 'files:process'; id: string; part: 'preview' | 'prepared'; generation: string; token: string };
