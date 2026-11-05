import { z } from '../../shared/validation';
import { controlCodeFromQuery } from '../domain/recipient-profile';
import type { MediaRecipient } from '../domain/media-settings';
import type { RecipientDirectoryPort } from '../ports/recipient-directory-port';

const recipientApiLimits = { timeoutMs: 15_000, searchResults: 10 } as const;

const groupSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), isMember: z.boolean().optional(), isOwner: z.boolean().optional(),
}).loose();
const groupsPageSchema = z.object({
  groups: z.array(groupSchema),
  pagination: z.object({ page: z.number().int().positive(), totalPages: z.number().int().nonnegative() }).loose().optional(),
}).loose().transform(page => ({
  groups: page.groups,
  pagination: page.pagination ?? { page: 1, totalPages: page.groups.length ? 1 : 0 },
}));
const friendSchema = z.union([
  z.object({ user: z.object({ id: z.string().min(1), username: z.string().min(1) }).loose() }).loose(),
  z.object({ id: z.string().min(1), username: z.string().min(1) }).loose(),
]);
const userRecordSchema = z.object({
  id: z.string().min(1), username: z.string().min(1),
  controlCode: z.string().min(1).optional(), code: z.string().min(1).optional(), control_code: z.string().min(1).optional(),
  sendCode: z.string().min(1).optional(),
}).loose().transform(user => ({
  id: user.id,
  username: user.username,
  controlCode: user.controlCode ?? user.code ?? user.control_code ?? user.sendCode ?? null,
}));
type ParsedUser = z.infer<typeof userRecordSchema>;

const parseUsersPayload = (json: unknown): ParsedUser[] => {
  const wrapped = z.union([
    z.array(z.unknown()),
    z.object({ users: z.array(z.unknown()) }).loose(),
    z.object({ results: z.array(z.unknown()) }).loose(),
  ]).safeParse(json);
  if (!wrapped.success) return [];
  const rows = Array.isArray(wrapped.data) ? wrapped.data
    : 'users' in wrapped.data ? wrapped.data.users : wrapped.data.results;
  return rows.flatMap(row => {
    const parsed = userRecordSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
};

const recipientFromUser = (user: ParsedUser): MediaRecipient | null => {
  const receiver = (user.controlCode ?? controlCodeFromQuery(user.username))?.toLowerCase();
  if (!receiver) return null;
  return { receiver, kind: 'user', label: user.username };
};

export type RecipientDirectoryReporter = (event: {
  event: 'start' | 'success' | 'failure'; source: 'groups' | 'friends'; status?: number; count?: number;
  stage?: string; detail?: string;
}) => void;

export class CtrlemRecipientDirectoryAdapter implements RecipientDirectoryPort {
  constructor(private readonly request: typeof fetch, private readonly report: RecipientDirectoryReporter) {}

  async list(): Promise<MediaRecipient[]> {
    const [groups, users] = await Promise.all([this.groups(), this.users()]);
    return [...groups, ...users];
  }

  search(kind: MediaRecipient['kind'], query: string): Promise<MediaRecipient[]> {
    return kind === 'group' ? this.groups(query) : query ? this.searchUsers(query) : this.users();
  }

  private async groups(query = ''): Promise<MediaRecipient[]> {
    this.report({ event: 'start', source: 'groups' });
    try {
      const first = await this.groupPage(1, query);
      const pages = [first];
      for (let page = 2; page <= first.pagination.totalPages; page++) pages.push(await this.groupPage(page, query));
      const recipients = pages.flatMap(page => page.groups)
        .filter(group => group.isMember === undefined && group.isOwner === undefined
          ? true : Boolean(group.isMember || group.isOwner))
        .map(group => ({ receiver: `group:${group.id}`, kind: 'group' as const, label: group.name }));
      this.report({ event: 'success', source: 'groups', count: recipients.length });
      return recipients;
    } catch (error) {
      this.report({ event: 'failure', source: 'groups', status: statusOf(error), stage: 'groups',
        detail: error instanceof Error ? error.message : String(error) }); throw error;
    }
  }

  private async groupPage(page: number, query: string) {
    const request = this.request;
    const search = query ? `&q=${encodeURIComponent(query)}` : '';
    const response = await request(`https://ctrlem.com/api/groups?page=${page}&myGroups=true${search}`, requestInit());
    if (!response.ok) throw new ResponseError(response.status);
    return groupsPageSchema.parse(await response.json());
  }

  private async users(): Promise<MediaRecipient[]> {
    this.report({ event: 'start', source: 'friends' });
    try {
      const request = this.request;
      const response = await request('https://ctrlem.com/api/friends', requestInit());
      if (!response.ok) throw new ResponseError(response.status);
      const friends = z.array(friendSchema).parse(await response.json())
        .map(entry => 'user' in entry ? entry.user : entry);
      const users = await Promise.all(friends.map(friend => this.findUser(friend.id, friend.username)));
      const recipients = users.flatMap(user => {
        if (!user) return [];
        const recipient = recipientFromUser(user);
        return recipient ? [recipient] : [];
      });
      this.report({ event: 'success', source: 'friends', count: recipients.length });
      return recipients;
    } catch (error) {
      this.report({ event: 'failure', source: 'friends', status: statusOf(error), stage: 'friends-list',
        detail: error instanceof Error ? error.message : String(error) }); throw error;
    }
  }

  private async searchUsers(query: string): Promise<MediaRecipient[]> {
    this.report({ event: 'start', source: 'friends' });
    const request = this.request;
    try {
      const term = encodeURIComponent(query);
      const response = await request(`https://ctrlem.com/api/users/search?q=${term}&limit=${recipientApiLimits.searchResults}`, requestInit());
      if (!response.ok) throw new ResponseError(response.status);
      const recipients = parseUsersPayload(await response.json()).flatMap(user => {
        const recipient = recipientFromUser(user);
        return recipient ? [recipient] : [];
      });
      this.report({ event: 'success', source: 'friends', count: recipients.length });
      return recipients;
    } catch (error) {
      this.report({ event: 'failure', source: 'friends', status: statusOf(error), stage: 'users-search',
        detail: error instanceof Error ? error.message : String(error) }); throw error;
    }
  }

  private async findUser(id: string, username: string) {
    const request = this.request;
    const term = encodeURIComponent(username);
    const response = await request(`https://ctrlem.com/api/users/search?q=${term}&limit=${recipientApiLimits.searchResults}`, requestInit());
    if (!response.ok) throw new ResponseError(response.status);
    return parseUsersPayload(await response.json()).find(user => user.id === id) ?? null;
  }
}

const requestInit = (): RequestInit => ({ credentials: 'include', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(recipientApiLimits.timeoutMs) });
class ResponseError extends Error { constructor(readonly status: number) { super(`CtrlEm request failed: ${status}`); } }
const statusOf = (error: unknown): number | undefined => error instanceof ResponseError ? error.status : undefined;
