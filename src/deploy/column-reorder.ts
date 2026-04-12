/**
 * Reorder table columns to match spec field order via moveNode.
 */
import type { NocoBaseClient } from '../client';
import { bestEffort } from '../utils/error-utils';

export async function reorderTableColumns(
  nb: NocoBaseClient,
  blockUid: string,
  specFields: string[],
): Promise<void> {
  await bestEffort('reorderColumns', async () => {
    const data = await nb.get({ uid: blockUid });
    const tree = data.tree;
    const rawCols = tree.subModels?.columns;
    const cols = (Array.isArray(rawCols) ? rawCols : rawCols ? [rawCols] : []) as unknown as Record<string, unknown>[];

    if (cols.length < 2) return;

    // Build fieldPath → uid map + find actions column
    const colUidMap = new Map<string, string>();
    let actionsUid = '';

    for (const c of cols) {
      const fp = (c.stepParams as Record<string, unknown>)
        ?.fieldSettings as Record<string, unknown>;
      const fieldPath = (fp?.init as Record<string, unknown>)?.fieldPath as string;
      if (fieldPath) {
        colUidMap.set(fieldPath, c.uid as string);
      } else if ((c.use as string || '').includes('TableActionsColumn')) {
        actionsUid = c.uid as string;
      }
    }

    // Desired order from spec
    const desired = specFields.filter(fp => colUidMap.has(fp));

    // Check if already correct
    const currentOrder = cols
      .map(c => {
        const fp = (c.stepParams as Record<string, unknown>)
          ?.fieldSettings as Record<string, unknown>;
        return (fp?.init as Record<string, unknown>)?.fieldPath as string;
      })
      .filter(Boolean);

    if (JSON.stringify(desired) === JSON.stringify(currentOrder)) return;

    // Move columns into desired order
    let prevUid = actionsUid;
    for (const fp of desired) {
      const colUid = colUidMap.get(fp)!;
      if (prevUid) {
        await nb.surfaces.moveNode(colUid, prevUid, 'after');
      }
      prevUid = colUid;
    }
  });
}
