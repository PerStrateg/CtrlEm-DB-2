import { z } from '../shared/validation';
import { isRedgifsBrowseHref } from './redgifs-frame';

export const MessageType = { RedgifsOverlaySend: 'redgifs:send', OpenTab: 'redgifs:open-tab' } as const;
export const redgifsRequest = z.discriminatedUnion('type', [
  z.object({ type: z.literal(MessageType.RedgifsOverlaySend), slug: z.string().regex(/^[a-zA-Z0-9]+$/),
    url: z.string().url().refine(value => {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname.endsWith('.redgifs.com') && /\.mp4$/i.test(url.pathname);
    }) }).strict(),
  z.object({ type: z.literal(MessageType.OpenTab), url: z.literal('https://www.redgifs.com/') }).strict(),
  z.object({ type: z.literal('redgifs:session-load') }).strict(),
  z.object({ type: z.literal('redgifs:session-save'), patch: z.object({
    href: z.string().refine(isRedgifsBrowseHref).optional(), scrollY: z.number().nonnegative().finite().optional(),
  }).strict() }).strict(),
]);
export type RedgifsOverlaySendMessage = Extract<z.infer<typeof redgifsRequest>, { type: 'redgifs:send' }>;
export type RedgifsOverlaySendResult = { ok: boolean; error?: string };
export type OpenTabResult = RedgifsOverlaySendResult;
