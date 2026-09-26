import { sendRuntimeMessage } from './ext-runtime';
import { isRedgifsBrowseHref } from './redgifs-frame';

export const REDGIFS_HOME = 'https://www.redgifs.com/';

export const REDGIFS_SESSION_KEY = 'ctrlem.redgifs.session';

export type RedgifsSession = {
  href: string;
  scrollY: number;
};

const DEFAULT_SESSION: RedgifsSession = {
  href: REDGIFS_HOME,
  scrollY: 0,
};

export function normalizeSession(value: unknown): RedgifsSession {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SESSION };
  const raw = value as Partial<RedgifsSession>;
  const href =
    typeof raw.href === 'string' && isRedgifsBrowseHref(raw.href)
      ? raw.href
      : REDGIFS_HOME;
  const scrollY =
    typeof raw.scrollY === 'number' && Number.isFinite(raw.scrollY)
      ? Math.max(0, raw.scrollY)
      : 0;
  return { href, scrollY };
}

export async function loadRedgifsSession(): Promise<RedgifsSession> {
  const reply = await sendRuntimeMessage<{ ok: boolean; value?: RedgifsSession }>({ type: 'redgifs:session-load' });
  if (!reply.ok) throw new Error('Could not load RedGifs session. Try Reload.');
  return normalizeSession(reply.value);
}

export async function saveRedgifsSession(
  patch: Partial<RedgifsSession>,
): Promise<RedgifsSession> {
  const reply = await sendRuntimeMessage<{ ok: boolean; value: RedgifsSession }>({ type: 'redgifs:session-save', patch });
  if (!reply.ok) throw new Error('Could not save RedGifs position.');
  return reply.value;
}
