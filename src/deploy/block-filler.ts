/**
 * Fill a compose-created block with content: JS, charts, actions, dividers, event flows.
 *
 * Compose creates empty shells. This fills them with actual content.
 * Each concern is delegated to a focused filler module in ./fillers/.
 *
 * ⚠️ PITFALLS:
 * - clickToOpen popup deployment priority: inline popup > popup file > template > default
 * - If field already has ChildPage with enough blocks, skip compose (let popup-deployer handle)
 * - filterManager must be set on PAGE-LEVEL BlockGridModel (not filterForm's own grid)
 * - JS items must be ordered before field items (syncGridItemsOrder at end)
 * - See src/PITFALLS.md for complete list.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { NocoBaseClient } from '../client';
import type { BlockSpec } from '../types/spec';
import type { BlockState } from '../types/state';
import { fixDisplayModels } from './display-model-fixer';
import { ensureJsHeader, replaceJsUids } from '../utils/js-utils';
import {
  deployClickToOpen,
  configureFilter,
  deployChart,
  deployNonComposeActions,
  deployJsItems,
  deployJsColumns,
  deployDividers,
  deployEventFlows,
  applyFieldLayout,
  syncGridItemsOrder,
} from './fillers';

export async function fillBlock(
  nb: NocoBaseClient,
  blockUid: string,
  gridUid: string,
  bs: BlockSpec,
  defaultColl: string,
  modDir: string,
  blockState: BlockState,
  allBlocksState: Record<string, BlockState> = {},
  pageGridUid = '',
  log: (msg: string) => void = console.log,
  popupContext: { depth: number; maxDepth: number; seenColls: Set<string> } = { depth: 0, maxDepth: 3, seenColls: new Set() },
): Promise<void> {
  const btype = bs.type;
  const coll = bs.coll || defaultColl;
  const mod = path.resolve(modDir);

  // ── Block title ──
  if (bs.title) {
    try {
      await nb.updateModel(blockUid, {
        cardSettings: { titleDescription: { title: bs.title } },
      });
    } catch (e) {
      log(`      ! title: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
    }
  }

  // ── Template reference (ReferenceFormGridModel) ──
  // If form was exported with templateRef, convert grid to reference mode
  const templateRef = bs.templateRef;
  if (templateRef?.targetUid && ['createForm', 'editForm'].includes(btype)) {
    try {
      // Find the form's grid UID
      const formData = await nb.get({ uid: blockUid });
      const formGrid = formData.tree.subModels?.grid;
      if (formGrid && !Array.isArray(formGrid)) {
        const formGridUid = (formGrid as { uid: string }).uid;
        // Convert grid to ReferenceFormGridModel with useTemplate
        await nb.models.save({
          uid: formGridUid,
          use: 'ReferenceFormGridModel',
          parentId: blockUid,
          subKey: 'grid',
          subType: 'object',
          sortIndex: 0,
          stepParams: {
            referenceSettings: {
              useTemplate: {
                templateUid: templateRef.templateUid,
                templateName: templateRef.templateName,
                targetUid: templateRef.targetUid,
                mode: templateRef.mode || 'reference',
              },
            },
          },
          flowRegistry: {},
        });
        log(`      ~ templateRef: ${templateRef.templateName} (reference mode)`);
      }
    } catch (e) {
      log(`      ! templateRef: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
    }
  }

  // ── Table settings: dataScope + pageSize ──
  const tableUpdates: Record<string, unknown> = {};
  if (bs.dataScope) tableUpdates.dataScope = { filter: bs.dataScope };
  if (bs.pageSize) tableUpdates.pageSize = { pageSize: bs.pageSize };
  if (bs.sort) tableUpdates.sort = bs.sort;
  if (Object.keys(tableUpdates).length) {
    try {
      await nb.updateModel(blockUid, { tableSettings: tableUpdates });
    } catch (e) {
      log(`      ! tableSettings: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
    }
  }

  // ── Clean compose auto-created actions for table ──
  // compose always creates actCol + default edit/view/delete; only keep what spec declares
  if (btype === 'table') {
    try {
      const tableData = await nb.get({ uid: blockUid });
      const cols = tableData.tree.subModels?.columns;
      const colArr = (Array.isArray(cols) ? cols : []) as { uid: string; use?: string; subModels?: Record<string, unknown> }[];
      const actCol = colArr.find(c => c.use?.includes('TableActionsColumn'));

      if (!(bs.recordActions?.length)) {
        // No recordActions in spec → remove entire actCol
        if (actCol) {
          await nb.surfaces.removeNode(actCol.uid);
          log(`      - action column removed (spec has none)`);
        }
      } else if (actCol) {
        // Has recordActions → clean compose-default buttons (edit/view/delete)
        // that aren't in spec, keep only spec-declared types
        const specTypes = new Set(
          (bs.recordActions || []).map(a => typeof a === 'string' ? a : (a as Record<string, unknown>).type as string),
        );
        const actColActs = actCol.subModels?.actions;
        const actColArr = (Array.isArray(actColActs) ? actColActs : []) as { uid: string; use?: string }[];
        const DEFAULT_RECORD_ACTIONS: Record<string, string> = {
          EditActionModel: 'edit', ViewActionModel: 'view', DeleteActionModel: 'delete',
        };
        for (const a of actColArr) {
          const defaultType = DEFAULT_RECORD_ACTIONS[a.use || ''];
          if (defaultType && !specTypes.has(defaultType)) {
            await nb.surfaces.removeNode(a.uid);
            log(`      - removed auto-created ${defaultType} button`);
          }
        }
      }

      // Also clean block-level recordActions auto-created by compose
      const blockRecActs = tableData.tree.subModels?.recordActions;
      const blockRecArr = (Array.isArray(blockRecActs) ? blockRecActs : []) as { uid: string; use?: string }[];
      const specRecTypes = new Set(
        (bs.recordActions || []).map(a => typeof a === 'string' ? a : (a as Record<string, unknown>).type as string),
      );
      for (const a of blockRecArr) {
        const use = a.use || '';
        const isDefault = ['EditActionModel', 'ViewActionModel', 'DeleteActionModel'].includes(use);
        const atype = use.replace('ActionModel', '').replace('Action', '').toLowerCase();
        if (isDefault && !specRecTypes.has(atype) && !specRecTypes.has('edit') && !specRecTypes.has('view') && !specRecTypes.has('delete')) {
          await nb.surfaces.removeNode(a.uid);
          log(`      - removed auto-created block ${atype}`);
        }
      }
    } catch { /* best effort */ }
  }

  // ── Fix display models ──
  const fieldStates = blockState.fields || {};
  if (Object.keys(fieldStates).length && coll && (btype === 'table' || btype === 'details')) {
    await fixDisplayModels(nb, blockUid, coll, btype as 'table' | 'details');
  }
  blockState.fields = fieldStates;

  // ── clickToOpen on table fields ──
  await deployClickToOpen(nb, bs, coll, fieldStates, mod, allBlocksState, popupContext, log);

  // ── FilterForm configuration (connect filter to table) ──
  if (btype === 'filterForm' && pageGridUid) {
    await configureFilter(nb, bs, blockUid, blockState, coll, allBlocksState, pageGridUid, log);
  }

  // ── JS Block code ──
  if (btype === 'jsBlock' && bs.file) {
    const jsPath = path.join(mod, bs.file);
    if (fs.existsSync(jsPath)) {
      let code = fs.readFileSync(jsPath, 'utf8');
      code = ensureJsHeader(code, { desc: bs.desc, jsType: 'JSBlockModel', coll });
      code = replaceJsUids(code, allBlocksState);
      await nb.updateModel(blockUid, {
        jsSettings: { runJs: { code, version: 'v1' } },
      });
      log(`      ~ JS: ${(bs.desc || bs.file).slice(0, 40)}`);
    }
  }

  // ── Chart config ──
  await deployChart(nb, blockUid, bs, mod, log);

  // ── Non-compose actions (legacy save_model) ──
  await deployNonComposeActions(nb, blockUid, bs, blockState, mod, log);

  // ── JS Items (inside detail/form grid, or list.item.grid) ──
  let itemGridUid = gridUid;
  if (['list', 'gridCard'].includes(btype) && !gridUid) {
    // List/GridCard: items live in block.subModels.item.subModels.grid
    try {
      const blockData = await nb.get({ uid: blockUid });
      const listItem = blockData.tree.subModels?.item;
      if (listItem && !Array.isArray(listItem)) {
        const listGrid = (listItem as { subModels?: Record<string, unknown> }).subModels?.grid;
        if (listGrid && !Array.isArray(listGrid)) {
          itemGridUid = (listGrid as { uid: string }).uid;
        }
      }
    } catch { /* skip */ }
  }
  await deployJsItems(nb, itemGridUid, bs, coll, mod, blockState, allBlocksState, log);

  // ── JS Columns (table) ──
  await deployJsColumns(nb, blockUid, bs, coll, mod, blockState, allBlocksState, log);

  // ── Dividers (in field_layout) ──
  await deployDividers(nb, gridUid, bs.field_layout || [], log);

  // ── Event flows ──
  await deployEventFlows(nb, blockUid, bs, mod, log);

  // ── Field layout (apply after all content created) ──
  await applyFieldLayout(nb, gridUid, bs.field_layout || [], log);

  // ── Sync grid items order to match spec declaration order ──
  await syncGridItemsOrder(nb, gridUid, bs, log);
}
