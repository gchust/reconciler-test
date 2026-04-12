/**
 * Apply field_layout covering ALL grid children.
 *
 * Converts the YAML field_layout DSL (rows of field names + dividers)
 * into gridSettings.rows/sizes for the block's internal grid.
 */
import type { NocoBaseClient } from '../../client';
import { bestEffort } from '../../utils/error-utils';
import type { LogFn } from './types';

export async function applyFieldLayout(
  nb: NocoBaseClient,
  gridUid: string,
  fieldLayout: unknown[],
  log?: LogFn,
): Promise<void> {
  if (!fieldLayout.length || !gridUid) return;

  await bestEffort('applyFieldLayout', async () => {
    const live = await nb.get({ uid: gridUid });
    const items = live.tree.subModels?.items;
    const itemArr = (Array.isArray(items) ? items : []) as { uid: string; use?: string; stepParams?: Record<string, unknown> }[];
    if (!itemArr.length) return;

    // Build uid map
    const uidMap = new Map<string, string>();
    const allUids = new Set<string>();
    for (const d of itemArr) {
      allUids.add(d.uid);
      const fp = (d.stepParams?.fieldSettings as Record<string, unknown>)?.init as Record<string, unknown>;
      const fieldPath = fp?.fieldPath as string;
      const label = ((d.stepParams?.markdownItemSetting as Record<string, unknown>)?.title as Record<string, unknown>)?.label as string;
      if (fieldPath) uidMap.set(fieldPath, d.uid);
      else if (label) uidMap.set(label, d.uid);
      else if (d.use?.includes('JSItem')) uidMap.set('_js_', d.uid);
    }

    const rows: Record<string, string[][]> = {};
    const sizes: Record<string, number[]> = {};
    let ri = 0;
    const covered = new Set<string>();

    for (const row of fieldLayout) {
      const rk = `r${ri}`;
      if (typeof row === 'string') {
        if (row.startsWith('---')) {
          const label = row.replace(/^-+\s*/, '').replace(/\s*-+$/, '').trim();
          const u = uidMap.get(label);
          if (u && !covered.has(u)) {
            rows[rk] = [[u]]; sizes[rk] = [24];
            covered.add(u); ri++;
          }
        }
      } else if (Array.isArray(row)) {
        const cols: string[][] = [];
        const colSizes: number[] = [];
        for (const item of row) {
          if (typeof item === 'string') {
            // Simple field name
            const u = uidMap.get(item);
            if (u && !covered.has(u)) {
              cols.push([u]); covered.add(u);
              colSizes.push(Math.floor(24 / row.length));
            }
          } else if (item && typeof item === 'object') {
            const obj = item as Record<string, unknown>;
            if (Array.isArray(obj.col)) {
              // {col: ['JS:...', 'field1', 'field2'], size: N} — stacked column
              const colUids: string[] = [];
              for (const name of obj.col as string[]) {
                const u = uidMap.get(name);
                if (u && !covered.has(u)) {
                  colUids.push(u); covered.add(u);
                }
              }
              if (colUids.length) {
                cols.push(colUids);
                colSizes.push((obj.size as number) || 24);
              }
            } else {
              // {fieldName: size} format
              const entries = Object.entries(obj).filter(([k]) => k !== 'col' && k !== 'size');
              if (entries.length) {
                const [name, size] = entries[0];
                const u = uidMap.get(name);
                if (u && !covered.has(u)) {
                  cols.push([u]); covered.add(u);
                  colSizes.push((size as number) || Math.floor(24 / row.length));
                }
              }
            }
          }
        }
        if (cols.length) {
          rows[rk] = cols;
          sizes[rk] = colSizes.length ? colSizes : cols.map(() => Math.floor(24 / cols.length));
          ri++;
        }
      }
    }

    // Append uncovered (safety net)
    for (const u of allUids) {
      if (!covered.has(u)) {
        const rk = `r${ri}`;
        rows[rk] = [[u]]; sizes[rk] = [24]; ri++;
      }
    }

    if (Object.keys(rows).length) {
      await nb.surfaces.setLayout(gridUid, rows, sizes);
    }
  }, log);
}
