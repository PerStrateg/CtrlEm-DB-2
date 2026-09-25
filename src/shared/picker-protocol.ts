import { z } from 'zod';
import { commandKeys } from '../model/commands';
import type { CommandKey } from '../model/commands';
import type { Library } from '../model/library';

export const selectionSchema = z.object({
  categoryId: z.union([z.string().uuid(), z.literal('default')]).optional(),
  itemId: z.string().min(1).optional(),
}).strict();
export const selectionsSchema = z.partialRecord(z.enum(commandKeys), selectionSchema);
export type PickerSelection = z.infer<typeof selectionSchema>;
export type PickerSelections = z.infer<typeof selectionsSchema>;
export const pickerRequests = [
  z.object({ type: z.literal('picker:load') }).strict(),
  z.object({ type: z.literal('picker:select'), command: z.enum(commandKeys), selection: selectionSchema }).strict(),
] as const;
export interface LoadedPicker { library: Library; selections: PickerSelections }
export interface PickerClient {
  loadPicker(): Promise<LoadedPicker>;
  select(command: CommandKey, selection: PickerSelection): Promise<void>;
}
