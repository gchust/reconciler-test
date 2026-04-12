/**
 * Deploy blocks into a page tab surface.
 *
 * Core loop: compose shells → fill content → apply layout.
 * Used for both pages and popup content.
 */
import type { NocoBaseClient } from '../client';
import type { BlockSpec, PageSpec, LayoutRow } from '../types/spec';
import type { BlockState } from '../types/state';
import type { ComposeBlockResult } from '../types/api';
import { toComposeBlock } from './block-composer';
import { fillBlock } from './block-filler';
import { reorderTableColumns } from './column-reorder';
import { slugify } from '../utils/slugify';

// Layout engine (imported separately)
import { parseLayoutSpec, applyLayout } from '../layout/layout-engine';

export async function deploySurface(
  nb: NocoBaseClient,
  tabUid: string,
  spec: PageSpec | BlockSpec & { blocks?: BlockSpec[]; coll?: string; layout?: LayoutRow[] },
  modDir: string,
  force = false,
  existingState: Record<string, BlockState> = {},
  log: (msg: string) => void = console.log,
  popupContext?: { refDepth: number; seenColls: Set<string> },
): Promise<Record<string, BlockState>> {
  const coll = (spec as { coll?: string }).coll || '';
  const blocksSpec = (spec as { blocks?: BlockSpec[] }).blocks || [];
  if (!blocksSpec.length) return existingState;

  const existing = { ...existingState };
  const blocksState: Record<string, BlockState> = { ...existing };

  // Find grid UID
  let gridUid = '';
  for (const getter of [
    () => nb.get({ tabSchemaUid: tabUid }),
    () => nb.get({ uid: tabUid }),
  ]) {
    try {
      const data = await getter();
      const tree = data.tree;
      const g = tree.subModels?.grid;
      if (g && !Array.isArray(g) && (g as { uid?: string }).uid) {
        gridUid = (g as { uid?: string }).uid!;
        break;
      }
      const popup = tree.subModels?.page;
      if (popup && !Array.isArray(popup)) {
        const tabs = (popup as { subModels?: Record<string, unknown> }).subModels?.tabs;
        const tabArr = Array.isArray(tabs) ? tabs : tabs ? [tabs] : [];
        if (tabArr.length) {
          const pg = (tabArr[0] as Record<string, unknown>).subModels as Record<string, unknown>;
          const pgGrid = pg?.grid as Record<string, unknown>;
          if (pgGrid?.uid) {
            gridUid = pgGrid.uid as string;
            break;
          }
        }
      }
    } catch { continue; /* try next grid getter */ }
  }

  // Check if all blocks already exist in state
  const allExist = blocksSpec.every(
    bs => (bs.key || bs.type) in existing,
  );

  if (allExist) {
    // All blocks exist — sync content to match spec
    log(`    = ${Object.keys(existing).length} blocks exist (sync)`);
    for (const bs of blocksSpec) {
      const key = bs.key || bs.type;
      if (!blocksState[key]?.uid) continue;
      const blockUid = blocksState[key].uid;
      const blockGrid = blocksState[key].grid_uid || '';

      // Add missing fields
      if (['table', 'filterForm', 'createForm', 'editForm', 'details'].includes(bs.type)) {
        const specFields = (bs.fields || [])
          .map(f => typeof f === 'string' ? f : (f.field || f.fieldPath || ''))
          .filter(fp => fp && !fp.startsWith('['));

        const existingFields = new Set(Object.keys(blocksState[key].fields || {}));
        for (const fp of specFields) {
          if (!existingFields.has(fp)) {
            try {
              const result = await nb.surfaces.addField(blockUid, fp);
              if (!blocksState[key].fields) blocksState[key].fields = {};
              blocksState[key].fields![fp] = {
                wrapper: result.wrapperUid || result.uid || '',
                field: result.fieldUid || '',
              };
              log(`      + field: ${fp}`);
            } catch (e) {
              log(`      ! field ${fp}: ${e instanceof Error ? e.message : e}`);
            }
          }
        }

        if (bs.type === 'table' && specFields.length) {
          await reorderTableColumns(nb, blockUid, specFields);
        }
      }

      // Update content (JS, charts, title, actions, settings)
      await fillBlock(nb, blockUid, blockGrid, bs, coll, modDir, blocksState[key], blocksState, gridUid, log, popupContext);
    }

    // Always apply layout
    const layoutSpec = (spec as { layout?: LayoutRow[] }).layout;
    if (layoutSpec && gridUid) {
      const uidMap: Record<string, string> = {};
      for (const [k, v] of Object.entries(blocksState)) {
        if (v.uid) uidMap[k] = v.uid;
      }
      const layout = parseLayoutSpec(layoutSpec, Object.keys(uidMap));
      await applyLayout(nb, gridUid, layout, uidMap);
    }

    return blocksState;
  }

  // ── Step 1: Compose missing block shells ──
  const composeBlocks: Record<string, unknown>[] = [];
  for (const bs of blocksSpec) {
    const key = bs.key || bs.type;
    if (key in existing) continue;  // already exists — skip compose (force handles via fillBlock)
    const cb = toComposeBlock(bs, coll);
    if (cb) composeBlocks.push(cb);
  }

  if (composeBlocks.length) {
    try {
      const mode = Object.keys(existing).length ? 'append' : 'replace';
      const result = await nb.surfaces.compose(tabUid, composeBlocks, mode as 'replace' | 'append');
      const composed = result.blocks || [];
      log(`    composed ${composed.length} block shells`);

      // Map compose results to spec keys
      let composeIdx = 0;
      for (const bs of blocksSpec) {
        const key = bs.key || bs.type;
        if (key in existing && !force) continue;
        const cb = toComposeBlock(bs, coll);
        if (!cb) continue;
        if (composeIdx < composed.length) {
          const cr = composed[composeIdx];
          const entry: BlockState = {
            uid: cr.uid,
            type: cr.type,
            grid_uid: cr.gridUid || '',
          };
          // Track field UIDs
          if (cr.fields?.length) {
            entry.fields = {};
            for (const f of cr.fields) {
              entry.fields[f.fieldPath || f.key] = {
                wrapper: f.wrapperUid || f.uid,
                field: f.fieldUid || '',
              };
            }
          }
          // Track action UIDs
          for (const ak of ['actions', 'recordActions'] as const) {
            const crActs = cr[ak];
            if (crActs?.length) {
              const stateKey = ak === 'recordActions' ? 'record_actions' : 'actions';
              (entry as unknown as Record<string, unknown>)[stateKey] = {};
              for (const a of crActs) {
                ((entry as unknown as Record<string, unknown>)[stateKey] as Record<string, { uid: string }>)[a.key || a.type] = { uid: a.uid };
              }
            }
          }
          blocksState[key] = entry;
          composeIdx++;
        }
      }

      // ── Step 2: Fill each NEW block with content ──
      for (const bs of blocksSpec) {
        const key = bs.key || bs.type;
        if (key in existing && !force) continue;
        if (!blocksState[key]) continue;
        await fillBlock(nb, blocksState[key].uid, blocksState[key].grid_uid || '', bs, coll, modDir, blocksState[key], blocksState, gridUid, log);
      }
    } catch (e) {
      log(`    ! compose: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Apply layout
  const layoutSpec = (spec as { layout?: LayoutRow[] }).layout;
  if (layoutSpec && gridUid) {
    const uidMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(blocksState)) {
      if (v.uid) uidMap[k] = v.uid;
    }
    const layout = parseLayoutSpec(layoutSpec, Object.keys(uidMap));
    await applyLayout(nb, gridUid, layout, uidMap);
    log(`    layout: ${layoutSpec.map(r => Array.isArray(r) ? `[${r.map(c => typeof c === 'string' ? c : Object.entries(c).map(([k, v]) => `${k}:${v}`).join(',')).join(', ')}]` : String(r)).join(' | ')}`);
  }

  return blocksState;
}
