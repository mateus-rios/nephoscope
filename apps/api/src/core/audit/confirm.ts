import { ProblemException } from '../problem/problem.js';

/**
 * Destructive actions require the typed short name, or the item count for bulk actions
 * (SPEC-0001 D-13, CA-50). Checked before anything is sent to Google.
 */
export function requireConfirmation(confirm: string | undefined, expected: string): void {
  if (confirm === undefined || confirm.trim() !== expected) {
    throw ProblemException.of('CONFIRMATION_REQUIRED', `Type "${expected}" to confirm.`, {
      errors: [{ path: 'confirm', message: `Must be "${expected}"` }],
    });
  }
}
