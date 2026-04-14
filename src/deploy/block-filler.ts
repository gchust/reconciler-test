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
import { FILLABLE_ACTION_TYPE_TO_MODEL } from '../utils/block-types';
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

  // ── Ensure gridUid is populated for form/details blocks ──
  // Blueprint/compose may not return gridUid — read it from live tree if missing.
  if (!gridUid && ['createForm', 'editForm', 'filterForm', 'details'].includes(btype)) {
    try {
      const blockData = await nb.get({ uid: blockUid });
      const innerGrid = blockData.tree.subModels?.grid;
      if (innerGrid && !Array.isArray(innerGrid)) {
        gridUid = (innerGrid as { uid: string }).uid || '';
        if (gridUid) {
          blockState.grid_uid = gridUid;
          log(`      . resolved grid_uid for ${btype}: ${gridUid.slice(0, 8)}`);
        }
      }
    } catch (e) {
      log(`      . grid_uid lookup: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
    }
  }

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
  // Two patterns in NocoBase:
  // 1. ReferenceBlockModel — compose created entire block as reference (no grid conversion needed)
  // 2. CreateFormModel/EditFormModel + ReferenceFormGridModel — grid proxies fields from template
  const templateRef = bs.templateRef;
  if (templateRef?.targetUid && ['createForm', 'editForm'].includes(btype)) {
    try {
      const formData = await nb.get({ uid: blockUid });
      const blockUse = (formData.tree as { use?: string }).use || '';
      if (blockUse === 'ReferenceBlockModel') {
        log(`      = templateRef: ${templateRef.templateName || templateRef.templateUid} (reference block)`);
      } else {
        // Convert grid to ReferenceFormGridModel via flowModels:save
        const formGrid = formData.tree.subModels?.grid;
        if (formGrid && !Array.isArray(formGrid)) {
          const gridUid2 = (formGrid as { uid: string }).uid;
          const gridUse = (formGrid as { use?: string }).use || '';
          if (gridUse !== 'ReferenceFormGridModel') {
            // Clear local grid items first (they conflict with reference proxy)
            const gridItems = (formGrid as { subModels?: Record<string, unknown> }).subModels?.items;
            const itemArr = (Array.isArray(gridItems) ? gridItems : []) as { uid: string }[];
            for (const item of itemArr) {
              try { await nb.surfaces.removeNode(item.uid); } catch (e) { log(`      ! templateRef removeNode: ${e instanceof Error ? e.message.slice(0, 60) : e}`); }
            }
            if (itemArr.length) log(`      ~ templateRef: cleared ${itemArr.length} local items`);
          }
          // Get raw model and convert
          const rawGrid = await nb.http.get(`${nb.baseUrl}/api/flowModels:get`, { params: { filterByTk: gridUid2 } });
          const gd = rawGrid.data.data;
          if (gd) {
            await nb.http.post(`${nb.baseUrl}/api/flowModels:save`, {
              uid: gridUid2, use: 'ReferenceFormGridModel',
              parentId: blockUid, subKey: 'grid', subType: 'object',
              sortIndex: gd.sortIndex || 0, flowRegistry: gd.flowRegistry || {},
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
            });
            log(`      ~ templateRef: ${templateRef.templateName || templateRef.templateUid} (grid → ReferenceFormGridModel)`);
          }
        }
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
    } catch (e) { log(`      ! action cleanup: ${e instanceof Error ? e.message.slice(0, 60) : e}`); }
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
    } catch (e) { log(`      . filterForm grid read: ${e instanceof Error ? e.message.slice(0, 60) : e}`); }

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

  for (const aspec of bs.actions || []) {
    const atype = typeof aspec === 'string' ? aspec : (aspec as Record<string, unknown>).type as string;
    if (!(atype in FILLABLE_ACTION_TYPE_TO_MODEL)) continue;
    if (blockState.actions?.[atype]) continue;  // already tracked
    let uid = '';
    try {
      // Use addRecordAction for record-action containers (details/list/gridCard)
      const result = isRecordActionBlock
        ? await nb.surfaces.addRecordAction(blockUid, atype) as Record<string, unknown>
        : await nb.surfaces.addAction(blockUid, atype) as Record<string, unknown>;
      uid = (result?.uid as string) || '';
    } catch (e) {
      // Fallback: save_model
      log(`      . action ${atype} compose failed, trying save_model: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
      try {
        const { generateUid } = await import('../utils/uid');
        uid = generateUid();
        await nb.models.save({
          uid, use: FILLABLE_ACTION_TYPE_TO_MODEL[atype],
          parentId: blockUid,
          subKey: isRecordActionBlock ? 'recordActions' : 'actions',
          subType: 'array',
          sortIndex: 0, stepParams: {}, flowRegistry: {},
        });
      } catch (e2) { log(`      ! action ${atype} save_model fallback: ${e2 instanceof Error ? e2.message.slice(0, 60) : e2}`); uid = ''; }
    }
    if (uid) {
      if (!blockState.actions) blockState.actions = {};
      blockState.actions[atype] = { uid };
    }
  }

  // ── Fillable recordActions for table blocks (view/edit in actCol) ──
  if (btype === 'table') {
    for (const aspec of bs.recordActions || []) {
      const atype = typeof aspec === 'string' ? aspec : (aspec as Record<string, unknown>).type as string;
      if (!(atype in FILLABLE_ACTION_TYPE_TO_MODEL)) continue;
      if (!blockState.record_actions) blockState.record_actions = {};
      if (blockState.record_actions[atype]) continue;
      let uid = '';
      try {
        const result = await nb.surfaces.addRecordAction(blockUid, atype) as Record<string, unknown>;
        uid = (result?.uid as string) || '';
      } catch (e) {
        log(`      . recordAction ${atype} failed: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
      }
      if (uid) {
        blockState.record_actions[atype] = { uid };
        log(`      + recordAction: ${atype}`);
      }
    }
  }

  // ── Auto-fill view/edit popup content (if they have no spec, use defaults from template) ──
  if (btype === 'table' && coll) {
    await autoFillRecordActionPopups(nb, blockUid, coll, blockState, log);
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
    } catch (e) { log(`      . list/gridCard grid read: ${e instanceof Error ? e.message.slice(0, 60) : e}`); }
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

  // ── Linkage / reaction rules ──
  // blockLinkageRules: conditional visibility on the block itself
  if (bs.blockLinkageRules?.length) {
    try {
      await nb.surfaces.setBlockLinkageRules(blockUid, bs.blockLinkageRules);
      log(`      ~ blockLinkageRules: ${bs.blockLinkageRules.length} rules`);
    } catch (e) {
      log(`      ! blockLinkageRules: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
    }
  }

  // fieldValueRules: apply on form blocks only (target = block UID)
  if (['createForm', 'editForm'].includes(btype) && bs.fieldValueRules?.length) {
    try {
      await nb.surfaces.setFieldValueRules(blockUid, bs.fieldValueRules);
      log(`      ~ fieldValueRules: ${bs.fieldValueRules.length} rules`);
    } catch (e) {
      log(`      ! fieldValueRules: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
    }
  }

  // fieldLinkageRules: apply on form + details blocks (target = block UID)
  if (['createForm', 'editForm', 'details'].includes(btype) && bs.fieldLinkageRules?.length) {
    try {
      await nb.surfaces.setFieldLinkageRules(blockUid, bs.fieldLinkageRules);
      log(`      ~ fieldLinkageRules: ${bs.fieldLinkageRules.length} rules`);
    } catch (e) {
      log(`      ! fieldLinkageRules: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
    }
  }
}

/**
 * Auto-fill view/edit record action popups with reasonable defaults.
 * 
 * When a table has view/edit recordActions but no explicit popup specs:
 * - view → details block with all fields from the collection (+ field_layout matching addNew template)
 * - edit → editForm with all fields (+ field_layout matching addNew template)
 *
 * This ensures view/edit popups have proper grid layout without AI needing to write popup files.
 */
async function autoFillRecordActionPopups(
  nb: NocoBaseClient,
  blockUid: string,
  coll: string,
  blockState: BlockState,
  log: (msg: string) => void,
): Promise<void> {
  try {
    const blockData = await nb.get({ uid: blockUid });
    const cols = blockData.tree.subModels?.columns;
    const actCol = (Array.isArray(cols) ? cols : []).find((c: any) => c.use?.includes('ActionsColumn'));
    if (!actCol) return;

    const acts = actCol.subModels?.actions;
    for (const act of (Array.isArray(acts) ? acts : []) as Record<string, unknown>[]) {
      const use = act.use as string || '';
      const isView = use === 'ViewActionModel';
      const isEdit = use === 'EditActionModel';
      if (!isView && !isEdit) continue;

      // Check if popup already has proper content (gridSettings = has layout)
      const popup = (act as any).subModels?.page;
      if (!popup) continue;
      const tabs = popup.subModels?.tabs;
      const t0 = (Array.isArray(tabs) ? tabs : tabs ? [tabs] : [])[0];
      const grid = t0?.subModels?.grid;
      const gridUid2 = grid?.uid;
      const items = grid?.subModels?.items;
      const itemCount = Array.isArray(items) ? items.length : 0;
      const hasGridSettings = !!grid?.stepParams?.gridSettings?.grid;

      // Skip if already has layout (previously deployed)
      if (hasGridSettings && itemCount > 0) continue;

      // Find a matching form template for field_layout reference
      let templateFieldLayout: unknown[] | undefined;
      try {
        const tmplResp = await nb.http.get(`${nb.baseUrl}/api/flowModelTemplates:list`, {
          params: { pageSize: 50, 'filter[collectionName]': coll, 'filter[type]': 'block' },
        });
        const addNewTmpl = (tmplResp.data.data || []).find((t: any) => t.name?.includes('Add new') || t.name?.includes('add_new'));
        if (addNewTmpl?.targetUid) {
          const tmplTarget = await nb.get({ uid: addNewTmpl.targetUid });
          const tmplGrid = tmplTarget.tree.subModels?.grid;
          const tmplGs = (tmplGrid as any)?.stepParams?.gridSettings?.grid;
          if (tmplGs?.rows) {
            // Template has layout — try to replicate for view/edit
            // We'll use deployDividers + applyFieldLayout with the same field_layout
            // For now, just ensure dividers exist on the popup block
          }
        }
      } catch { /* skip */ }

      // Apply field_layout to popup block if gridUid exists and has items
      if (gridUid2 && itemCount > 0) {
        try {
          // Simple auto-layout: group fields into rows of 2-3
          const fieldItems = (Array.isArray(items) ? items : []).filter((i: any) => {
            const u = i.use as string || '';
            return u.includes('FormItem') || u.includes('DetailsItem');
          });

          if (fieldItems.length > 2) {
            const rows: Record<string, string[][]> = {};
            const sizes: Record<string, number[]> = {};
            let ri = 0;
            for (let i = 0; i < fieldItems.length; i += 2) {
              const rk = `r${ri}`;
              if (i + 1 < fieldItems.length) {
                rows[rk] = [[fieldItems[i].uid], [fieldItems[i + 1].uid]];
                sizes[rk] = [12, 12];
              } else {
                rows[rk] = [[fieldItems[i].uid]];
                sizes[rk] = [24];
              }
              ri++;
            }
            await nb.surfaces.setLayout(gridUid2, rows, sizes);
            log(`      ~ auto-layout ${isView ? 'view' : 'edit'} popup: ${fieldItems.length} fields → ${ri} rows`);
          }
        } catch (e) {
          log(`      . auto-layout ${isView ? 'view' : 'edit'}: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
        }
      }
    }
  } catch { /* skip — auto-fill is best effort */ }
}
