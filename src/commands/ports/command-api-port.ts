import type { AutoExecution, AutoOutcome } from '../../model/auto-send';

export interface CommandApiPort {
  execute(execution: AutoExecution): Promise<AutoOutcome>;
}
