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
  popupContext: { seenColls: Set<string> } = { seenColls: new Set() },
  popupTargetFields?: Set<string>,
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

  // ── Template reference ──
  // Compose with template param creates ReferenceBlockModel + flowModelTemplateUsages entry.
  // That's the correct pattern — no further grid conversion needed.
  // Only log for visibility.
  const templateRef = bs.templateRef;
  if (templateRef?.targetUid && ['createForm', 'editForm'].includes(btype)) {
    try {
      const formData = await nb.get({ uid: blockUid });
      const blockUse = (formData.tree as { use?: string }).use || '';
      if (blockUse === 'ReferenceBlockModel') {
        log(`      = templateRef: ${templateRef.templateName || templateRef.templateUid} (reference block)`);
      } else {
        log(`      = templateRef: ${templateRef.templateName || templateRef.templateUid} (block is ${blockUse}, skipped)`);
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
        // Has recordActions → remove ALL existing actCol buttons first.
        // deployNonComposeActions will re-create spec-declared ones with correct config.
        const actColActs = actCol.subModels?.actions;
        const actColArr = (Array.isArray(actColActs) ? actColActs : []) as { uid: string; use?: string }[];
        if (actColArr.length) {
          for (const a of actColArr) {
            await nb.surfaces.removeNode(a.uid);
          }
          log(`      - cleared ${actColArr.length} auto-created actCol buttons`);
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
  await deployClickToOpen(nb, bs, coll, fieldStates, mod, allBlocksState, popupContext, log, popupTargetFields);

  // ── FilterForm custom fields (FilterFormCustomFieldModel) ──
  if (btype === 'filterForm' && gridUid) {
    // Check which custom fields actually exist in live tree (not just state)
    const liveCustomNames = new Set<string>();
    try {
      const gridData = await nb.get({ uid: gridUid });
      const gridItems = (gridData.tree.subModels?.items || []) as { use?: string; stepParams?: Record<string, unknown> }[];
      for (const gi of (Array.isArray(gridItems) ? gridItems : [])) {
        if (gi.use === 'FilterFormCustomFieldModel') {
          const cfName = ((gi.stepParams?.formItemSettings as Record<string, unknown>)?.fieldSettings as Record<string, unknown>)?.name as string || '';
          if (cfName) liveCustomNames.add(cfName);
        }
      }
    } catch { /* skip */ }

    for (const f of bs.fields || []) {
      if (typeof f !== 'object' || (f as unknown as Record<string, unknown>).type !== 'custom') continue;
      const custom = f as unknown as Record<string, unknown>;
      const customName = (custom.name as string) || '';
      if (!customName) continue;
      // Check if actually exists in live tree
      if (liveCustomNames.has(customName)) continue;
      try {
        const newUid = (await import('../utils/uid')).generateUid();
        await nb.models.save({
          uid: newUid,
          use: 'FilterFormCustomFieldModel',
          parentId: gridUid,
          subKey: 'items',
          subType: 'array',
          sortIndex: 0,
          stepParams: {
            formItemSettings: {
              fieldSettings: {
                name: customName,
                title: custom.title || customName,
                fieldModel: custom.fieldModel || 'InputFilterFieldModel',
                fieldModelProps: custom.fieldModelProps || {},
                source: custom.source || [],
              },
            },
          },
          flowRegistry: {},
        });
        if (!blockState.fields) blockState.fields = {};
        blockState.fields[customName] = { wrapper: newUid, field: '' };
        log(`      + custom filter: ${custom.title || customName}`);
      } catch (e) {
        log(`      ! custom filter ${customName}: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
      }
    }
  }

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

  // ── Ensure compose-type actions exist ──
  // DetailsBlockModel is a "record action container" → must use addRecordAction, not addAction.
  // Form blocks (createForm/editForm/filterForm) use addAction normally.
  const RECORD_ACTION_BLOCKS = new Set(['details', 'list', 'gridCard']);
  const isRecordActionBlock = RECORD_ACTION_BLOCKS.has(btype);

  const COMPOSE_ACTIONS: Record<string, string> = {
    filter: 'FilterActionModel', refresh: 'RefreshActionModel',
    addNew: 'AddNewActionModel', delete: 'DeleteActionModel',
    bulkDelete: 'BulkDeleteActionModel', submit: 'SubmitActionModel',
    reset: 'ResetActionModel', edit: 'EditActionModel', view: 'ViewActionModel',
  };
  for (const aspec of bs.actions || []) {
    const atype = typeof aspec === 'string' ? aspec : (aspec as Record<string, unknown>).type as string;
    if (!(atype in COMPOSE_ACTIONS)) continue;
    if (blockState.actions?.[atype]) continue;  // already tracked
    let uid = '';
    try {
      // Use addRecordAction for record-action containers (details/list/gridCard)
      const result = isRecordActionBlock
        ? await nb.surfaces.addRecordAction(blockUid, atype) as Record<string, unknown>
        : await nb.surfaces.addAction(blockUid, atype) as Record<string, unknown>;
      uid = (result?.uid as string) || '';
    } catch {
      // Fallback: save_model
      try {
        const { generateUid } = await import('../utils/uid');
        uid = generateUid();
        await nb.models.save({
          uid, use: COMPOSE_ACTIONS[atype],
          parentId: blockUid,
          subKey: isRecordActionBlock ? 'recordActions' : 'actions',
          subType: 'array',
          sortIndex: 0, stepParams: {}, flowRegistry: {},
        });
      } catch { uid = ''; }
    }
    if (uid) {
      if (!blockState.actions) blockState.actions = {};
      blockState.actions[atype] = { uid };
    }
  }

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
  await deployDividers(nb, gridUid, bs, blockState, log);

  // ── Event flows ──
  await deployEventFlows(nb, blockUid, bs, mod, log);

  // ── Field layout (apply after all content created) ──
  if ((bs.field_layout || []).length) {
    // Explicit layout → set gridSettings.rows
    await applyFieldLayout(nb, gridUid, bs.field_layout!, log, bs);
  } else if (gridUid && ['filterForm', 'createForm', 'editForm', 'details'].includes(btype)) {
    // No field_layout → reorder items via moveNode to match spec declaration
    await syncGridItemsOrder(nb, gridUid, bs, log);
  }
}
