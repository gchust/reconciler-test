/**
 * Configure filterForm — connect filter fields to target table/reference blocks.
 *
 * Sets filterFormItemSettings on each field + filterManager on page-level grid.
 *
 * ⚠️ PITFALL: filterManager must be set on PAGE-LEVEL BlockGridModel,
 *    not the filterForm's own grid. See src/PITFALLS.md.
 */
import type { NocoBaseClient } from '../../client';
import type { BlockSpec } from '../../types/spec';
import type { BlockState } from '../../types/state';
import type { LogFn } from './types';

export async function configureFilter(
  nb: NocoBaseClient,
  bs: BlockSpec,
  blockUid: string,
  blockState: BlockState,
  coll: string,
  allBlocksState: Record<string, BlockState>,
  pageGridUid: string,
  log: LogFn,
): Promise<void> {
  // Find target table/reference UIDs
  const targetUids: string[] = [];
  for (const [, binfo] of Object.entries(allBlocksState)) {
    if (binfo.type === 'table' || binfo.type === 'reference') {
      if (binfo.uid) targetUids.push(binfo.uid);
    }
  }
  const defaultTarget = targetUids[0] || '';

  // 1. Set label + defaultTargetUid on each FilterFormItem
  const fieldStates = blockState.fields || {};
  for (const f of bs.fields || []) {
    if (typeof f !== 'object') continue;
    const fp = f.field || f.fieldPath || '';
    const label = f.label || '';
    if (!fp) continue;

    const wrapperUid = fieldStates[fp]?.wrapper;
    if (!wrapperUid) continue;

    const settings: Record<string, unknown> = {};
    if (defaultTarget) {
      settings.init = {
        filterField: { name: fp, title: label || fp, interface: 'input', type: 'string' },
        defaultTargetUid: defaultTarget,
      };
    }
    if (label) {
      settings.label = { label };
      settings.showLabel = { showLabel: true };
    }

    if (Object.keys(settings).length) {
      try {
        await nb.updateModel(wrapperUid, { filterFormItemSettings: settings });
        log(`      filter ${fp}: ${label || fp}`);
      } catch (e) {
        log(`      ! filter ${fp}: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
      }
    }
  }

  // 2. Set filterManager on page-level BlockGridModel
  if (!pageGridUid) return;

  try {
    const data = await nb.get({ uid: blockUid });
    const grid = data.tree.subModels?.grid;
    const gridItems = (grid && !Array.isArray(grid))
      ? ((grid as unknown as Record<string, unknown>).subModels as Record<string, unknown>)?.items
      : [];
    const items = (Array.isArray(gridItems) ? gridItems : []) as Record<string, unknown>[];

    const fmEntries: Record<string, unknown>[] = [];
    for (const f of bs.fields || []) {
      if (typeof f !== 'object' || !f.filterPaths?.length) continue;
      const fp = f.field || '';
      if (!fp) continue;

      // Find FilterFormItem UID in live grid
      for (const item of items) {
        const itemFp = ((item.stepParams as Record<string, unknown>)?.fieldSettings as Record<string, unknown>)
          ?.init as Record<string, unknown>;
        if ((itemFp?.fieldPath as string) === fp) {
          for (const tid of targetUids) {
            fmEntries.push({
              filterId: item.uid,
              targetId: tid,
              filterPaths: f.filterPaths,
            });
          }
          log(`      filter ${fp} → ${JSON.stringify(f.filterPaths)} (${targetUids.length} targets)`);
          break;
        }
      }
    }

    if (fmEntries.length) {
      // Save filterManager on page-level grid
      const pgResp = await nb.http.get(`${nb.baseUrl}/api/flowModels:get`, {
        params: { filterByTk: pageGridUid },
      });
      const pgData = pgResp.data?.data || {};
      await nb.http.post(`${nb.baseUrl}/api/flowModels:save`, {
        uid: pageGridUid,
        use: pgData.use || 'BlockGridModel',
        parentId: pgData.parentId || '',
        subKey: 'grid',
        subType: 'object',
        sortIndex: 0,
        stepParams: pgData.stepParams || {},
        flowRegistry: pgData.flowRegistry || {},
        filterManager: fmEntries,
      });
    }
  } catch (e) {
    log(`      ! filterManager: ${e instanceof Error ? e.message : e}`);
  }
}
