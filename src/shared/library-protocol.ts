// v3 schemas are interpreter-only and work with extension CSP (no code generation).
import { z } from 'zod/v3';
import { contentTypes } from '../model/library';
import type { Library, LibraryChange, ChangeResult } from '../model/library';

const id = z.string().uuid();
const revision = z.number().int().nonnegative();
const type = z.enum(contentTypes);
const item = z.object({ id, value: z.string(), label: z.string().optional() }).strict();
export const librarySchema = z.object({
  version: z.literal(1), revision,
  categories: z.array(z.object({
    id, type, name: z.string().trim().min(1), revision, items: z.array(item),
    previewsEnabled: z.boolean(), purpose: z.literal('input').optional(),
  }).strict()),
}).strict();

const draftSchema = z.object({
  id, type, baseRevision: revision, name: z.string(), text: z.string(), previewsEnabled: z.boolean(),
  dirtyName: z.boolean(), dirtyText: z.boolean(),
  selectionStart: revision, selectionEnd: revision, scrollTop: z.number().nonnegative(),
}).strict();
export type EditorDraft = z.infer<typeof draftSchema>;
export const sessionSchema = z.object({
  activeType: type, selected: z.record(type, id.optional()), drafts: z.array(draftSchema),
}).strict();
export type EditorSession = z.infer<typeof sessionSchema>;
export const emptySession = (): EditorSession => ({ activeType: 'link', selected: {}, drafts: [] });

const changeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), type, name: z.string() }).strict(),
  z.object({ kind: z.literal('update'), id, baseRevision: revision,
    name: z.string().optional(), text: z.string().optional(), previewsEnabled: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('delete'), id, baseRevision: revision }).strict(),
  z.object({ kind: z.literal('move'), id, baseRevision: revision, beforeId: id.nullable() }).strict(),
]);
export const requestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('library:load') }).strict(),
  z.object({ type: z.literal('library:change'), change: changeSchema }).strict(),
  z.object({ type: z.literal('library:session'), session: sessionSchema }).strict(),
]);
export type LibraryRequest = z.infer<typeof requestSchema>;
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
export interface LoadedLibrary { library: Library; session: EditorSession }
export interface LibraryClient {
  load(): Promise<LoadedLibrary>;
  change(change: LibraryChange): Promise<ChangeResult>;
  saveSession(session: EditorSession): Promise<void>;
  subscribe(listener: (library: Library) => void): () => void;
}
