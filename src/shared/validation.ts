import { z } from 'zod';

// Both background and content scripts run under CSP without dynamic code generation.
z.config({ jitless: true });
export { z };
