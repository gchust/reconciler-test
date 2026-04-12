/**
 * Fill a compose-created block with content: JS, charts, actions, dividers, event flows.
 *
 * Compose creates empty shells. This fills them with actual content.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { NocoBaseClient } from '../client';
import type { BlockSpec } from '../types/spec';
import type { BlockState } from '../types/state';
import { fixDisplayModels } from './display-model-fixer';
import { ensureJsHeader, replaceJsUids } from '../utils/js-utils';
import { generateUid } from '../utils/uid';
import { loadYaml } from '../utils/yaml';

const NON_COMPOSE_ACTION_MAP: Record<string, string> = {
  duplicate: 'DuplicateActionModel',
  export: 'ExportActionModel',
  import: 'ImportActionModel',
  link: 'LinkActionModel',
  workflowTrigger: 'CollectionTriggerWorkflowActionModel',
  ai: 'AIEmployeeButtonModel',
  expandCollapse: 'ExpandCollapseActionModel',
  popup: 'PopupCollectionActionModel',
  updateRecord: 'UpdateRecordActionModel',
};

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
): Promise<void> {
  const btype = bs.type;
  const coll = bs.coll || defaultColl;
  const mod = path.resolve(modDir);

  // ── Table settings: dataScope + pageSize ──
  const tableUpdates: Record<string, unknown> = {};
  if (bs.dataScope) tableUpdates.dataScope = { filter: bs.dataScope };
  if (bs.pageSize) tableUpdates.pageSize = { pageSize: bs.pageSize };
  if (bs.sort) tableUpdates.sort = bs.sort;
  if (Object.keys(tableUpdates).length) {
    try { await nb.updateModel(blockUid, { tableSettings: tableUpdates }); } catch { /* skip */ }
  }

  // ── Fix display models ──
  const fieldStates = blockState.fields || {};
  if (Object.keys(fieldStates).length && coll && (btype === 'table' || btype === 'details')) {
    await fixDisplayModels(nb, blockUid, coll, btype as 'table' | 'details');
  }
  blockState.fields = fieldStates;

  // ── clickToOpen on table fields (default detail popup) ──
  if (btype === 'table') {
    for (const f of bs.fields || []) {
      if (typeof f !== 'object' || !f.clickToOpen) continue;
      const fp = f.field || f.fieldPath || '';
      const wrapperUid = fieldStates[fp]?.wrapper;
      if (!wrapperUid) continue;
      try {
        const colData = await nb.get({ uid: wrapperUid });
        const fieldSub = colData.tree.subModels?.field;
        if (fieldSub && !Array.isArray(fieldSub)) {
          const fieldUid = (fieldSub as { uid: string }).uid;
          const update: Record<string, unknown> = {
            displayFieldSettings: { clickToOpen: { clickToOpen: true } },
          };
          // Set popupSettings if specified
          const ps = (f as unknown as Record<string, unknown>).popupSettings as Record<string, unknown>;
          if (ps) {
            const popupColl = (ps.collectionName || coll) as string;

            // Step 1: Set popupSettings to enable click-to-open
            update.popupSettings = {
              openView: {
                collectionName: popupColl,
                dataSourceKey: 'main',
                mode: ps.mode || 'drawer',
                size: ps.size || 'medium',
                pageModelClass: 'ChildPageModel',
                uid: fieldUid,
                filterByTk: ps.filterByTk || '{{ ctx.record.id }}',
              },
            };

            // Step 2: Compose popup content from export spec or default
            // Check if the field has popup content spec in export (popupBlocks)
            const popupBlocks = (f as unknown as Record<string, unknown>).popupBlocks as Record<string, unknown>[];
            try {
              if (popupBlocks?.length) {
                // Use exported popup blocks
                const composeBlocks = popupBlocks.map(b => ({
                  key: b.key || 'details',
                  type: b.type || 'details',
                  resource: { collectionName: popupColl, dataSourceKey: 'main', binding: 'currentRecord' },
                  fields: (b.fields as string[])?.map(fp => ({ fieldPath: fp })),
                }));
                await nb.surfaces.compose(fieldUid, composeBlocks, 'replace');
              } else {
                // Default: create details block with all collection fields
                const meta = await nb.collections.fieldMeta(popupColl);
                const defaultFields = Object.keys(meta)
                  .filter(k => !['id', 'createdById', 'updatedById'].includes(k))
                  .slice(0, 10)
                  .map(k => ({ fieldPath: k }));
                await nb.surfaces.compose(fieldUid, [{
                  key: 'details',
                  type: 'details',
                  resource: { collectionName: popupColl, dataSourceKey: 'main', binding: 'currentRecord' },
                  fields: defaultFields,
                }], 'replace');
              }
            } catch { /* popup might already have content */ }
          }
          await nb.updateModel(fieldUid, update);
          log(`      ~ clickToOpen: ${fp}`);
        }
      } catch { /* skip */ }
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
  if (btype === 'chart' && bs.chart_config) {
    const cfgPath = path.join(mod, bs.chart_config);
    if (fs.existsSync(cfgPath)) {
      let config: Record<string, unknown>;

      if (bs.chart_config.endsWith('.yaml') || bs.chart_config.endsWith('.yml')) {
        const spec = loadYaml<Record<string, string>>(cfgPath);
        let sql = spec.sql || '';
        if (spec.sql_file) {
          const sf = path.join(mod, spec.sql_file);
          if (fs.existsSync(sf)) sql = fs.readFileSync(sf, 'utf8');
        }
        let renderJs = spec.render || '';
        if (spec.render_file) {
          const rf = path.join(mod, spec.render_file);
          if (fs.existsSync(rf)) renderJs = fs.readFileSync(rf, 'utf8');
        }
        config = {
          query: { mode: 'sql', sql },
          chart: { option: { mode: 'custom', raw: renderJs } },
        };
      } else {
        config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      }

      await nb.updateModel(blockUid, { chartSettings: { configure: config } });

      const sql = (config.query as Record<string, unknown>)?.sql as string;
      if (sql) {
        // Save SQL template
        await nb.http.post(`${nb.baseUrl}/api/flowSql:save`, {
          type: 'selectRows', uid: blockUid,
          dataSourceKey: 'main', sql, bind: {},
        });

        // Try to run — report errors
        try {
          const clean = sql
            .replace(/\{%\s*if\s+[^%]*%\}.*?\{%\s*endif\s*%\}/gs, '')
            .split('\n').filter(l => !l.includes('{{') && !l.includes('{%')).join('\n');
          const resp = await nb.http.post(`${nb.baseUrl}/api/flowSql:run`, {
            type: 'selectRows', uid: blockUid,
            dataSourceKey: 'main', sql: clean, bind: {},
          });
          if (resp.status >= 400 || resp.data?.errors?.length) {
            const errMsg = resp.data?.errors?.[0]?.message || '';
            log(`    ✗ chart SQL error (${bs.chart_config}): ${errMsg}`);
          } else {
            log(`      + chart: ${bs.chart_config} (SQL verified ✓)`);
          }
        } catch (e) {
          log(`      + chart: ${bs.chart_config}`);
        }
      }
    }
  }

  // ── Non-compose actions (legacy save_model) ──
  const allActions = [...(bs.actions || []), ...(bs.recordActions || [])];
  for (const aspec of allActions) {
    const atype = typeof aspec === 'string' ? aspec : (aspec as Record<string, unknown>).type as string;
    const amodel = NON_COMPOSE_ACTION_MAP[atype];
    if (!amodel) continue;

    let actionSp = typeof aspec === 'object' ? (aspec as Record<string, unknown>).stepParams as Record<string, unknown> || {} : {};
    let actionProps = typeof aspec === 'object' ? (aspec as Record<string, unknown>).props as Record<string, unknown> || {} : {};

    // AI button shorthand: { type: ai, employee: viz, tasks_file: ./ai/tasks.yaml }
    if (atype === 'ai' && typeof aspec === 'object') {
      const spec = aspec as Record<string, unknown>;
      if (spec.employee && !Object.keys(actionSp).length) {
        const { sp, props } = buildAiButton(spec, blockUid, modDir);
        actionSp = sp;
        actionProps = props;
      }
    }

    // Check if already in state
    const existingActions = blockState.actions || {};
    const existingRec = blockState.record_actions || {};
    if (atype in existingActions || atype in existingRec) {
      if (Object.keys(actionSp).length || Object.keys(actionProps).length) {
        const existingUid = (existingActions[atype]?.uid || existingRec[atype]?.uid) || '';
        if (existingUid) {
          const update: Record<string, unknown> = { uid: existingUid };
          if (Object.keys(actionSp).length) update.stepParams = actionSp;
          if (Object.keys(actionProps).length) update.props = actionProps;
          await nb.models.save(update);
        }
      }
      continue;
    }

    // Determine subKey
    const isRecordAction = (bs.recordActions || []).includes(aspec);
    const desiredSubKey = isRecordAction ? 'recordActions' : 'actions';

    // Create
    const newUid = generateUid();
    await nb.models.save({
      uid: newUid, use: amodel,
      parentId: blockUid, subKey: desiredSubKey, subType: 'array',
      sortIndex: 0, stepParams: actionSp, props: actionProps, flowRegistry: {},
    });
    const stateKey = isRecordAction ? 'record_actions' : 'actions';
    if (!blockState[stateKey]) blockState[stateKey] = {};
    blockState[stateKey]![atype] = { uid: newUid };
  }

  // ── JS Items (inside detail/form grid) ──
  const jsItems = bs.js_items || [];
  if (jsItems.length && gridUid) {
    for (const jsSpec of jsItems) {
      if (!jsSpec.file) continue;
      const jsPath = path.join(mod, jsSpec.file);
      if (!fs.existsSync(jsPath)) continue;

      let code = fs.readFileSync(jsPath, 'utf8');
      code = ensureJsHeader(code, { desc: jsSpec.desc, jsType: 'JSItemModel', coll });
      code = replaceJsUids(code, allBlocksState);

      const existing = blockState.js_items?.[jsSpec.key];
      if (existing?.uid) {
        await nb.updateModel(existing.uid, {
          jsSettings: { runJs: { code, version: 'v1' } },
        });
      } else {
        const newUid = generateUid();
        await nb.models.save({
          uid: newUid, use: 'JSItemModel',
          parentId: gridUid, subKey: 'items', subType: 'array',
          sortIndex: 0, flowRegistry: {},
          stepParams: { jsSettings: { runJs: { code, version: 'v1' } } },
        });
        if (!blockState.js_items) blockState.js_items = {};
        blockState.js_items[jsSpec.key] = { uid: newUid };
      }
      log(`      ~ JS item: ${jsSpec.desc || jsSpec.key}`);
    }

  }

  // ── JS Columns (table) ──
  const jsCols = bs.js_columns || [];
  if (jsCols.length && btype === 'table') {
    for (const jsSpec of jsCols) {
      if (!jsSpec.file) continue;
      const jsPath = path.join(mod, jsSpec.file);
      if (!fs.existsSync(jsPath)) continue;

      let code = fs.readFileSync(jsPath, 'utf8');
      code = ensureJsHeader(code, { desc: jsSpec.desc, jsType: 'JSColumnModel', coll });

      const existing = blockState.js_columns?.[jsSpec.key];
      if (existing?.uid) {
        await nb.updateModel(existing.uid, {
          jsSettings: { runJs: { code, version: 'v1' } },
        });
      } else {
        const newUid = generateUid();
        await nb.models.save({
          uid: newUid, use: 'JSColumnModel',
          parentId: blockUid, subKey: 'columns', subType: 'array',
          sortIndex: 0, flowRegistry: {},
          stepParams: {
            jsSettings: { runJs: { code, version: 'v1' } },
            fieldSettings: { init: { fieldPath: jsSpec.field } },
          },
        });
        if (!blockState.js_columns) blockState.js_columns = {};
        blockState.js_columns[jsSpec.key] = { uid: newUid };
      }
      log(`      ~ JS col: ${jsSpec.desc || jsSpec.key}`);
    }
  }

  // ── Dividers (in field_layout) ──
  const fieldLayout = bs.field_layout || [];
  if (fieldLayout.length && gridUid) {
    for (const row of fieldLayout) {
      if (typeof row === 'string' && row.startsWith('---')) {
        const label = row.replace(/^-+\s*/, '').replace(/\s*-+$/, '').trim();
        if (label) {
          await nb.models.addDivider(gridUid, label);
          log(`      + divider: ${label}`);
        }
      }
    }
  }

  // ── Event flows ──
  const eventFlows = bs.event_flows || [];
  if (eventFlows.length) {
    const flowRegistry: Record<string, unknown> = {};
    for (const ef of eventFlows) {
      if (!ef.file) continue;
      const efPath = path.join(mod, ef.file);
      if (!fs.existsSync(efPath)) continue;
      const code = fs.readFileSync(efPath, 'utf8');
      const flowKey = ef.flow_key || `custom_${Object.keys(flowRegistry).length}`;
      const stepKey = ef.step_key || 'runJs';
      flowRegistry[flowKey] = {
        key: flowKey,
        on: ef.event || 'formValuesChange',
        title: ef.desc || flowKey,
        steps: {
          [stepKey]: {
            key: stepKey, use: 'runjs', sort: 1, flowKey,
            runJs: { code },
          },
        },
      };
    }
    if (Object.keys(flowRegistry).length) {
      try {
        await nb.models.save({ uid: blockUid, flowRegistry });
      } catch {
        await nb.http.post(`${nb.baseUrl}/api/flowModels:update?filterByTk=${blockUid}`, {
          options: { flowRegistry },
        });
      }
    }
  }

  // ── Field layout (apply after all content created) ──
  if (fieldLayout.length && gridUid) {
    await applyFieldLayout(nb, gridUid, fieldLayout);
  }

  // ── Sync grid items order to match spec declaration order ──
  // Builds desired order from: js_items first (if declared before fields), then fields, then remaining
  if (gridUid && ['filterForm', 'createForm', 'editForm', 'details'].includes(btype)) {
    await syncGridItemsOrder(nb, gridUid, bs);
  }
}

/**
 * Apply field_layout covering ALL grid children.
 */
async function applyFieldLayout(
  nb: NocoBaseClient,
  gridUid: string,
  fieldLayout: unknown[],
): Promise<void> {
  try {
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
        for (const item of row) {
          const name = typeof item === 'string' ? item
            : (typeof item === 'object' && item ? Object.keys(item)[0] : null);
          if (name) {
            const u = uidMap.get(name);
            if (u && !covered.has(u)) {
              cols.push([u]); covered.add(u);
            }
          }
        }
        if (cols.length) {
          rows[rk] = cols;
          sizes[rk] = cols.map(() => Math.floor(24 / cols.length));
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
  } catch { /* best-effort */ }
}

/**
 * Sync grid items order to match the spec's declaration order.
 *
 * In YAML, the order of js_items, fields, dividers determines display order.
 * This reads live grid items, builds desired order from spec, then moveNode.
 */
async function syncGridItemsOrder(
  nb: NocoBaseClient,
  gridUid: string,
  bs: BlockSpec,
): Promise<void> {
  try {
    const live = await nb.get({ uid: gridUid });
    const rawItems = live.tree.subModels?.items;
    const items = (Array.isArray(rawItems) ? rawItems : []) as { uid: string; use?: string; stepParams?: Record<string, unknown> }[];
    if (items.length < 2) return;

    // Build UID lookup: fieldPath → uid, jsItem → uid, divider label → uid
    const uidByFieldPath = new Map<string, string>();
    const uidByUse = new Map<string, string[]>();
    for (const item of items) {
      const fp = (item.stepParams?.fieldSettings as Record<string, unknown>)
        ?.init as Record<string, unknown>;
      const fieldPath = fp?.fieldPath as string;
      if (fieldPath) uidByFieldPath.set(fieldPath, item.uid);

      const use = item.use || '';
      const group = uidByUse.get(use) || [];
      group.push(item.uid);
      uidByUse.set(use, group);
    }

    // Build desired order from spec: walk through js_items and fields in declaration order
    const desiredUids: string[] = [];

    // js_items first (they appear before fields in the spec)
    const jsItemUids = uidByUse.get('JSItemModel') || [];

    // Check spec: are js_items declared before fields? (YAML key order)
    // In the BlockSpec, js_items comes after fields in the interface,
    // but in the actual YAML, the order depends on how it was written.
    // We use a simple heuristic: if js_items exist, put them first.
    // This matches NocoBase's typical pattern (filter stats above search input).
    desiredUids.push(...jsItemUids);

    // Then fields in spec order
    const specFields = (bs.fields || []).map(f =>
      typeof f === 'string' ? f : (f.field || f.fieldPath || ''),
    ).filter(Boolean);
    for (const fp of specFields) {
      const uid = uidByFieldPath.get(fp);
      if (uid && !desiredUids.includes(uid)) desiredUids.push(uid);
    }

    // Append any remaining items not yet covered (dividers, etc.)
    for (const item of items) {
      if (!desiredUids.includes(item.uid)) desiredUids.push(item.uid);
    }

    // Apply order via moveNode
    if (desiredUids.length > 1) {
      for (let i = 1; i < desiredUids.length; i++) {
        await nb.surfaces.moveNode(desiredUids[i], desiredUids[i - 1], 'after');
      }
    }
  } catch { /* best effort */ }
}

/**
 * Build AI button stepParams + props from shorthand DSL.
 * Shorthand: { type: ai, employee: viz, tasks_file: ./ai/tasks.yaml }
 */
function buildAiButton(
  spec: Record<string, unknown>,
  blockUid: string,
  modDir: string,
): { sp: Record<string, unknown>; props: Record<string, unknown> } {
  const employee = (spec.employee as string) || '';
  const tasksFile = (spec.tasks_file as string) || '';

  let tasksSpec: Record<string, unknown>[] = [];
  if (tasksFile) {
    const tf = path.join(modDir, tasksFile);
    if (fs.existsSync(tf)) {
      const td = loadYaml<Record<string, unknown>>(tf);
      tasksSpec = (td.tasks as Record<string, unknown>[]) || [];
    }
  }

  const builtTasks: Record<string, unknown>[] = [];
  for (const t of tasksSpec) {
    let systemText = (t.system as string) || '';
    if (!systemText && t.system_file) {
      const sf = path.join(modDir, t.system_file as string);
      if (fs.existsSync(sf)) systemText = fs.readFileSync(sf, 'utf8');
    }
    builtTasks.push({
      title: t.title || '',
      autoSend: t.autoSend ?? true,
      message: {
        user: t.user || '',
        system: systemText,
        workContext: [{ type: 'flow-model', uid: blockUid }],
        skillSettings: {},
      },
    });
  }

  return {
    sp: { shortcutSettings: { editTasks: { tasks: builtTasks } } },
    props: {
      aiEmployee: { username: employee },
      context: { workContext: [{ type: 'flow-model', uid: blockUid }] },
      auto: false,
    },
  };
}

/**
 * Configure filterForm — connect filter fields to target table/reference blocks.
 * Sets filterFormItemSettings on each field + filterManager on page-level grid.
 */
async function configureFilter(
  nb: NocoBaseClient,
  bs: BlockSpec,
  blockUid: string,
  blockState: BlockState,
  coll: string,
  allBlocksState: Record<string, BlockState>,
  pageGridUid: string,
  log: (msg: string) => void,
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
      } catch { /* skip */ }
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
