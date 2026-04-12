/**
 * Deploy dividers declared in field_layout.
 *
 * Dividers are rows starting with "---" followed by a label.
 */
import type { NocoBaseClient } from '../../client';
import type { LogFn } from './types';

export async function deployDividers(
  nb: NocoBaseClient,
  gridUid: string,
  fieldLayout: unknown[],
  log: LogFn,
): Promise<void> {
  if (!fieldLayout.length || !gridUid) return;

  for (const row of fieldLayout) {
    if (typeof row === 'string' && row.startsWith('---')) {
      const label = row.replace(/^-+\s*/, '').replace(/\s*-+$/, '').trim();
      if (label) {
        try {
          await nb.models.addDivider(gridUid, label);
          log(`      + divider: ${label}`);
        } catch (e) {
          log(`      ! divider ${label}: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
        }
      }
    }
  }
}
