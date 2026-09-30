import { z } from '../../shared/validation';
import type { MediaRecipient } from '../domain/media-settings';
import type { RecipientDirectoryPort } from '../ports/recipient-directory-port';

const recipientApiLimits = { timeoutMs: 15_000, searchResults: 10 } as const;

const groupSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), isMember: z.boolean(), isOwner: z.boolean(),
}).loose();
const groupsPageSchema = z.object({
  groups: z.array(groupSchema),
  pagination: z.object({ page: z.number().int().positive(), totalPages: z.number().int().positive() }).loose(),
}).loose();
const friendSchema = z.object({ user: z.object({ id: z.string().min(1), username: z.string().min(1) }).loose() }).loose();
const userSchema = z.object({ id: z.string().min(1), username: z.string().min(1), controlCode: z.string().min(1) }).loose();

export type RecipientDirectoryReporter = (event: {
  event: 'start' | 'success' | 'failure'; source: 'groups' | 'friends'; status?: number; count?: number;
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
        .filter(group => group.isMember || group.isOwner)
        .map(group => ({ receiver: `group:${group.id}`, kind: 'group' as const, label: group.name }));
      this.report({ event: 'success', source: 'groups', count: recipients.length });
      return recipients;
    } catch (error) {
      this.report({ event: 'failure', source: 'groups', status: statusOf(error) }); throw error;
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
      const friends = z.array(friendSchema).parse(await response.json());
      const users = await Promise.all(friends.map(friend => this.findUser(friend.user.id, friend.user.username)));
      const recipients = users.flatMap(user => user ? [{
        receiver: user.controlCode.toLowerCase(), kind: 'user' as const, label: user.username,
      }] : []);
      this.report({ event: 'success', source: 'friends', count: recipients.length });
      return recipients;
    } catch (error) {
      this.report({ event: 'failure', source: 'friends', status: statusOf(error) }); throw error;
    }
  }

  private async searchUsers(query: string): Promise<MediaRecipient[]> {
    this.report({ event: 'start', source: 'friends' });
    const request = this.request;
    try {
      const response = await request(`https://ctrlem.com/api/users/search?q=${encodeURIComponent(query)}&limit=${recipientApiLimits.searchResults}`, requestInit());
      if (!response.ok) throw new ResponseError(response.status);
      const recipients = z.array(userSchema).parse(await response.json()).map(user => ({
        receiver: user.controlCode.toLowerCase(), kind: 'user' as const, label: user.username,
      }));
      this.report({ event: 'success', source: 'friends', count: recipients.length });
      return recipients;
    } catch (error) {
      this.report({ event: 'failure', source: 'friends', status: statusOf(error) }); throw error;
    }
  }

  private async findUser(id: string, username: string) {
    const request = this.request;
    const response = await request(`https://ctrlem.com/api/users/search?q=${encodeURIComponent(username)}&limit=${recipientApiLimits.searchResults}`, requestInit());
    if (!response.ok) throw new ResponseError(response.status);
    return z.array(userSchema).parse(await response.json()).find(user => user.id === id);
  }
}

const requestInit = (): RequestInit => ({ credentials: 'include', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(recipientApiLimits.timeoutMs) });
class ResponseError extends Error { constructor(readonly status: number) { super(`CtrlEm request failed: ${status}`); } }
const statusOf = (error: unknown): number | undefined => error instanceof ResponseError ? error.status : undefined;
