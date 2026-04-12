/**
 * Export a single block node from live NocoBase tree.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { NocoBaseClient } from '../client';
import type { FlowModelNode } from '../types/api';
import { slugify } from '../utils/slugify';
import { dumpYaml } from '../utils/yaml';
import { extractJsDesc } from '../utils/js-utils';

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function safeWrite(filePath: string, content: string) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, content);
}

export const TYPE_MAP: Record<string, string> = {
  TableBlockModel: 'table',
  FilterFormBlockModel: 'filterForm',
  CreateFormModel: 'createForm',
  EditFormModel: 'editForm',
  DetailsBlockModel: 'details',
  ListBlockModel: 'list',
  JSBlockModel: 'jsBlock',
  GridCardBlockModel: 'gridCard',
  ChartBlockModel: 'chart',
  MarkdownBlockModel: 'markdown',
  CommentsBlockModel: 'comments',
  RecordHistoryBlockModel: 'recordHistory',
  IframeBlockModel: 'iframe',
  ReferenceBlockModel: 'reference',
};

export interface PopupRef {
  field: string;
  field_uid: string;
  block_key?: string;
  target?: string;
}

export interface ExportedBlock {
  spec: Record<string, unknown>;
  key: string;
  state: Record<string, unknown>;
  popupRefs: PopupRef[];
}

/**
 * Export a single block from a FlowModel tree node.
 */
export function exportBlock(
  item: FlowModelNode,
  jsDir: string | null,
  prefix: string,
  index: number,
  usedKeys: Set<string>,
): ExportedBlock | null {
  const use = item.use || '';
  const uid = item.uid;
  const sp = (item.stepParams || {}) as Record<string, unknown>;

  const btype = TYPE_MAP[use];
  if (!btype) return null;

  // Block title
  const cardSettings = sp.cardSettings as Record<string, unknown>;
  const titleDesc = cardSettings?.titleDescription as Record<string, unknown>;
  const title = (titleDesc?.title as string) || '';

  // Generate key
  let key: string;
  if (title) {
    key = slugify(title);
  } else if (btype === 'jsBlock') {
    const jsSettings = sp.jsSettings as Record<string, unknown>;
    const code = ((jsSettings?.runJs as Record<string, unknown>)?.code as string) || '';
    const desc = extractJsDesc(code);
    key = desc ? slugify(desc) : btype;
  } else {
    key = btype;
  }

  // Deduplicate
  if (usedKeys.has(key)) {
    let counter = 2;
    while (usedKeys.has(`${key}_${counter}`)) counter++;
    key = `${key}_${counter}`;
  }
  usedKeys.add(key);

  const spec: Record<string, unknown> = { key, type: btype };
  if (title) spec.title = title;

  // Collection + resource
  const resSettings = sp.resourceSettings as Record<string, unknown>;
  const resInit = (resSettings?.init || {}) as Record<string, unknown>;
  const coll = resInit.collectionName as string || '';
  if (coll) spec.coll = coll;

  // Resource binding
  const binding: Record<string, unknown> = {};
  if (resInit.filterByTk) binding.filterByTk = resInit.filterByTk;
  if (resInit.associationName) binding.associationName = resInit.associationName;
  if (resInit.sourceId) binding.sourceId = resInit.sourceId;
  if (Object.keys(binding).length) spec.resource_binding = binding;

  // Table settings
  const tableSettings = sp.tableSettings as Record<string, unknown>;
  if (tableSettings) {
    const ds = tableSettings.dataScope as Record<string, unknown>;
    if (ds?.filter) spec.dataScope = ds.filter;
    const ps = tableSettings.pageSize as Record<string, unknown>;
    const pageSize = typeof ps === 'object' ? ps?.pageSize : ps;
    if (pageSize && pageSize !== 20) spec.pageSize = pageSize;
    if (tableSettings.sort) spec.sort = tableSettings.sort;
  }

  const popupRefs: PopupRef[] = [];

  // ── JS Block ──
  if (btype === 'jsBlock') {
    const jsSettings = sp.jsSettings as Record<string, unknown>;
    const code = ((jsSettings?.runJs as Record<string, unknown>)?.code as string) || '';
    if (code) {
      const desc = extractJsDesc(code);
      if (desc) spec.desc = desc;
      if (jsDir) {
        const fname = prefix ? `${prefix}_${key}.js` : `${key}.js`;
        safeWrite(path.join(jsDir, fname), code);
        spec.file = `./js/${fname}`;
      }
    }
  }

  // ── Chart ──
  if (btype === 'chart') {
    const chartSettings = sp.chartSettings as Record<string, unknown>;
    const configure = (chartSettings?.configure || {}) as Record<string, unknown>;
    if (Object.keys(configure).length && jsDir) {
      const chartDir = path.join(path.dirname(jsDir), 'charts');
      fs.mkdirSync(chartDir, { recursive: true });
      const base = prefix ? `${prefix}_${key}` : key;

      const query = configure.query as Record<string, unknown>;
      const chartOpt = configure.chart as Record<string, unknown>;
      const sql = (query?.sql as string) || '';
      const raw = ((chartOpt?.option as Record<string, unknown>)?.raw as string) || '';

      const chartSpec: Record<string, string> = {};
      if (sql) {
        const sqlFname = `${base}.sql`;
        safeWrite(path.join(chartDir, sqlFname), sql);
        chartSpec.sql_file = `./charts/${sqlFname}`;
      }
      if (raw) {
        const renderFname = `${base}_render.js`;
        safeWrite(path.join(chartDir, renderFname), raw);
        chartSpec.render_file = `./charts/${renderFname}`;
      }
      const yamlFname = `${base}.yaml`;
      safeWrite(path.join(chartDir, yamlFname), dumpYaml(chartSpec));
      spec.chart_config = `./charts/${yamlFname}`;
    }
  }

  // ── Reference block — dereference template to get actual form fields ──
  if (btype === 'reference') {
    const refSettings = sp.referenceSettings as Record<string, unknown>;
    const useTemplate = refSettings?.useTemplate as Record<string, unknown>;
    if (useTemplate) {
      spec._reference = {
        templateUid: useTemplate.templateUid,
        templateName: useTemplate.templateName,
        targetUid: useTemplate.targetUid,
        mode: useTemplate.mode || 'reference',
      };
    }
  }

  // ── Table fields + columns ──
  if (btype === 'table') {
    const { fields, jsCols, fieldPopups } = exportTableContents(item, jsDir, prefix, key);
    if (fields.length) spec.fields = fields;
    if (jsCols.length) spec.js_columns = jsCols;
    popupRefs.push(...fieldPopups);
  }

  // ── Form/detail fields ──
  if (['createForm', 'editForm', 'details', 'filterForm'].includes(btype)) {
    const { fields, jsItems, fieldLayout, fieldPopups } = exportFormContents(item, jsDir, prefix, key);
    if (fields.length) spec.fields = fields;
    if (jsItems.length) spec.js_items = jsItems;
    if (fieldLayout.length) spec.field_layout = fieldLayout;
    popupRefs.push(...fieldPopups);
  }

  // ── Actions ──
  const { actions, recordActions, actionPopups } = exportActions(item, key, jsDir, prefix);
  if (actions.length) spec.actions = actions;
  if (recordActions.length) spec.recordActions = recordActions;
  popupRefs.push(...actionPopups);

  // State
  const state: Record<string, unknown> = { uid, type: btype };

  return { spec: { ...spec, _popups: popupRefs }, key, state, popupRefs };
}

// ── Table contents ──

function exportTableContents(
  item: FlowModelNode,
  jsDir: string | null,
  prefix: string,
  blockKey: string,
): { fields: unknown[]; jsCols: unknown[]; fieldPopups: PopupRef[] } {
  const cols = item.subModels?.columns;
  const colArr = (Array.isArray(cols) ? cols : []) as FlowModelNode[];
  const fields: unknown[] = [];
  const jsCols: unknown[] = [];
  const fieldPopups: PopupRef[] = [];

  for (const col of colArr) {
    if (col.use?.includes('TableActionsColumn')) continue;

    const fp = (col.stepParams as Record<string, unknown>)?.fieldSettings as Record<string, unknown>;
    const fieldPath = ((fp?.init || {}) as Record<string, unknown>).fieldPath as string;

    if (col.use === 'JSColumnModel') {
      const js = (col.stepParams as Record<string, unknown>)?.jsSettings as Record<string, unknown>;
      const code = ((js?.runJs as Record<string, unknown>)?.code as string) || '';
      const colTitle = ((col.stepParams as Record<string, unknown>)?.tableColumnSettings as Record<string, unknown>)
        ?.title as Record<string, unknown>;
      const title = (colTitle?.title as string) || '';
      const desc = code ? extractJsDesc(code) : '';
      if (code && jsDir) {
        const safe = slugify(title || desc || `col_${jsCols.length}`);
        const fname = `${prefix}_${blockKey}_col_${safe}.js`;
        safeWrite(path.join(jsDir, fname), code);
        jsCols.push({
          key: safe, field: fieldPath || '',
          file: `./js/${fname}`,
          ...(title ? { title } : {}),
          ...(desc ? { desc } : {}),
        });
      }
    } else if (fieldPath) {
      // Check if field has clickToOpen (default detail popup on click)
      const fieldModel = col.subModels?.field;
      const clickToOpen = fieldModel && !Array.isArray(fieldModel)
        ? ((fieldModel as FlowModelNode).stepParams as Record<string, unknown>)
          ?.displayFieldSettings as Record<string, unknown>
        : null;
      const isClickable = (clickToOpen?.clickToOpen as Record<string, unknown>)?.clickToOpen === true;

      if (isClickable) {
        const popupSettings = ((fieldModel as FlowModelNode).stepParams as Record<string, unknown>)
          ?.popupSettings as Record<string, unknown>;
        const openView = popupSettings?.openView as Record<string, unknown>;
        const fieldSpec: Record<string, unknown> = { field: fieldPath, clickToOpen: true };
        // Export popup config (collection, mode, filterByTk)
        if (openView) {
          fieldSpec.popupSettings = {
            collectionName: openView.collectionName,
            mode: openView.mode || 'drawer',
            size: openView.size || 'medium',
            filterByTk: openView.filterByTk || '{{ ctx.record.id }}',
          };
          // Follow the popup uid to read actual popup blocks
          const popupFieldUid = openView.uid as string;
          if (popupFieldUid) {
            fieldSpec._popupSourceUid = popupFieldUid;
          }
        }
        fields.push(fieldSpec);
      } else {
        fields.push(fieldPath);
      }
    }

    // Check for popup on column's display field (col → field → page)
    const fieldModel = col.subModels?.field;
    if (fieldModel && !Array.isArray(fieldModel)) {
      const fmNode = fieldModel as FlowModelNode;
      const popupPage = fmNode.subModels?.page;
      if (popupPage && !Array.isArray(popupPage) && (popupPage as FlowModelNode).uid) {
        const openView = ((fmNode.stepParams as Record<string, unknown>)?.popupSettings as Record<string, unknown>)
          ?.openView as Record<string, unknown>;
        fieldPopups.push({
          field: fieldPath || col.uid,
          field_uid: fmNode.uid || col.uid,
          block_key: blockKey,
          target: `$SELF.${blockKey}.fields.${fieldPath || col.uid}`,
        });
      }
    }
    // Also check direct popup on column (fallback)
    if (!fieldModel && col.subModels?.page) {
      fieldPopups.push({
        field: fieldPath || col.uid, field_uid: col.uid, block_key: blockKey,
        target: `$SELF.${blockKey}.fields.${fieldPath || col.uid}`,
      });
    }
  }

  return { fields, jsCols, fieldPopups };
}

// ── Form/detail contents ──

function exportFormContents(
  item: FlowModelNode,
  jsDir: string | null,
  prefix: string,
  blockKey: string,
): { fields: unknown[]; jsItems: unknown[]; fieldLayout: unknown[]; fieldPopups: PopupRef[] } {
  const grid = item.subModels?.grid;
  if (!grid || Array.isArray(grid)) return { fields: [], jsItems: [], fieldLayout: [], fieldPopups: [] };

  const gridNode = grid as FlowModelNode;
  const rawItems = gridNode.subModels?.items;
  const items = (Array.isArray(rawItems) ? rawItems : []) as FlowModelNode[];
  const fields: unknown[] = [];
  const jsItems: unknown[] = [];
  const fieldPopups: PopupRef[] = [];

  // Build uid → name map for layout extraction
  const uidToName = new Map<string, string>();

  for (const gi of items) {
    const sp = (gi.stepParams || {}) as Record<string, unknown>;

    if (gi.use?.includes('JSItem')) {
      const js = sp.jsSettings as Record<string, unknown>;
      const code = ((js?.runJs as Record<string, unknown>)?.code as string) || '';
      const desc = code ? extractJsDesc(code) : '';
      const jsName = desc ? slugify(desc) : `js_${jsItems.length}`;

      if (code && jsDir) {
        const fname = `${prefix}_${blockKey}_${jsName}.js`;
        safeWrite(path.join(jsDir, fname), code);
        jsItems.push({ key: jsName, file: `./js/${fname}`, desc });
      }
      uidToName.set(gi.uid, desc ? `[JS:${desc}]` : '[JS]');

    } else if (gi.use?.includes('DividerItem') || gi.use?.includes('MarkdownItem')) {
      const label = ((sp.markdownItemSetting as Record<string, unknown>)
        ?.title as Record<string, unknown>)?.label as string || '';
      uidToName.set(gi.uid, label ? `--- ${label} ---` : '---');

    } else {
      const fpInit = (sp.fieldSettings as Record<string, unknown>)?.init as Record<string, unknown>;
      const fieldPath = (fpInit?.fieldPath as string) || '';
      if (fieldPath) {
        fields.push(fieldPath);
        uidToName.set(gi.uid, fieldPath);

        // Check for popup on field (in subModels.field.subModels.page)
        const fieldSub = gi.subModels?.field;
        if (fieldSub && !Array.isArray(fieldSub)) {
          const fpage = (fieldSub as FlowModelNode).subModels?.page;
          if (fpage && !Array.isArray(fpage) && (fpage as FlowModelNode).uid) {
            fieldPopups.push({
              field: fieldPath,
              field_uid: (fieldSub as FlowModelNode).uid || gi.uid,
              block_key: blockKey,
              target: `$SELF.${blockKey}.fields.${fieldPath}`,
            });
          }
        }
      }
      // Also check direct popup on the item itself
      if (gi.subModels?.page && !gi.use?.includes('JSItem')) {
        const existsAlready = fieldPopups.some(p => p.field_uid === gi.uid);
        if (!existsAlready) {
          const fieldPath2 = (fpInit?.fieldPath as string) || gi.uid;
          fieldPopups.push({
            field: fieldPath2, field_uid: gi.uid, block_key: blockKey,
            target: `$SELF.${blockKey}.fields.${fieldPath2}`,
          });
        }
      }
    }
  }

  // Extract field_layout from gridSettings.rows
  const fieldLayout = extractGridLayout(gridNode, uidToName);

  return { fields, jsItems, fieldLayout, fieldPopups };
}

/**
 * Convert gridSettings.rows back to field_layout DSL.
 * Handles: single items, equal-width rows, complex rows (different sizes, stacked cols).
 */
function extractGridLayout(
  grid: FlowModelNode,
  uidToName: Map<string, string>,
): unknown[] {
  const gs = (grid.stepParams as Record<string, unknown>)?.gridSettings as Record<string, unknown>;
  const gridInner = (gs?.grid || {}) as Record<string, unknown>;
  const rows = (gridInner.rows || {}) as Record<string, string[][]>;
  const sizes = (gridInner.sizes || {}) as Record<string, number[]>;
  const rowOrder = (gridInner.rowOrder || Object.keys(rows)) as string[];

  if (!Object.keys(rows).length) return [];

  const layout: unknown[] = [];

  for (const rk of rowOrder) {
    const cols = rows[rk];
    if (!cols) continue;
    const sz = sizes[rk] || [];
    const nCols = cols.length;
    const defaultSize = nCols > 0 ? Math.floor(24 / nCols) : 24;

    const allSingle = cols.every(col => col.length === 1);
    const equalSize = new Set(sz).size <= 1;

    if (nCols === 1 && cols[0].length === 1) {
      // Single item row
      const name = uidToName.get(cols[0][0]) || cols[0][0].slice(0, 8);
      if (name.startsWith('--- ')) {
        layout.push(name); // divider as string
      } else {
        layout.push([name]);
      }
    } else if (allSingle && equalSize && sz.every(s => s === defaultSize)) {
      // Simple equal-width row
      const names = cols.map(col => uidToName.get(col[0]) || col[0].slice(0, 8));
      layout.push(names);
    } else {
      // Complex row (different sizes or stacked items)
      const rowItems: unknown[] = [];
      for (let j = 0; j < cols.length; j++) {
        const s = j < sz.length ? sz[j] : defaultSize;
        const names = cols[j].map(u => uidToName.get(u) || u.slice(0, 8));

        if (names.length === 1) {
          if (s === defaultSize && equalSize) {
            rowItems.push(names[0]);
          } else {
            rowItems.push({ [names[0]]: s });
          }
        } else {
          // Stacked column
          rowItems.push({ col: names, size: s });
        }
      }
      layout.push(rowItems);
    }
  }

  return layout;
}

// ── Actions ──

const ACTION_TYPE_MAP: Record<string, string> = {
  FilterActionModel: 'filter',
  RefreshActionModel: 'refresh',
  AddNewActionModel: 'addNew',
  DeleteActionModel: 'delete',
  BulkDeleteActionModel: 'bulkDelete',
  SubmitActionModel: 'submit',
  FormSubmitActionModel: 'submit',
  ResetActionModel: 'reset',
  FilterFormSubmitActionModel: 'submit',
  FilterFormResetActionModel: 'reset',
  FilterFormCollapseActionModel: 'collapse',
  EditActionModel: 'edit',
  ViewActionModel: 'view',
  DuplicateActionModel: 'duplicate',
  ExportActionModel: 'export',
  ImportActionModel: 'import',
  LinkActionModel: 'link',
  CollectionTriggerWorkflowActionModel: 'workflowTrigger',
  AIEmployeeButtonModel: 'ai',
  ExpandCollapseActionModel: 'expandCollapse',
  PopupCollectionActionModel: 'popup',
  UpdateRecordActionModel: 'updateRecord',
  RecordHistoryExpandActionModel: 'historyExpand',
  RecordHistoryCollapseActionModel: 'historyCollapse',
};

function exportActions(
  item: FlowModelNode,
  blockKey: string,
  jsDir: string | null = null,
  prefix = '',
): { actions: unknown[]; recordActions: unknown[]; actionPopups: PopupRef[] } {
  const actions: unknown[] = [];
  const recordActions: unknown[] = [];
  const actionPopups: PopupRef[] = [];

  for (const subKey of ['actions', 'recordActions'] as const) {
    const raw = item.subModels?.[subKey];
    const arr = (Array.isArray(raw) ? raw : []) as FlowModelNode[];
    const target = subKey === 'actions' ? actions : recordActions;

    for (const act of arr) {
      const atype = ACTION_TYPE_MAP[act.use || ''];
      if (!atype) continue;

      // Complex actions — export as shorthand + files
      if (atype === 'ai') {
        const actProps = (act as unknown as Record<string, unknown>).props as Record<string, unknown>;
        const employee = (actProps?.aiEmployee as Record<string, unknown>)?.username as string || '';
        const sp = (act.stepParams || {}) as Record<string, unknown>;
        const tasks = ((sp.shortcutSettings as Record<string, unknown>)?.editTasks as Record<string, unknown>)?.tasks;

        const actionSpec: Record<string, unknown> = { type: 'ai', employee };

        // Extract tasks to file if jsDir available
        if (tasks && Array.isArray(tasks) && jsDir) {
          const aiDir = path.join(path.dirname(jsDir), 'ai');
          const tasksFname = `${prefix || 'page'}_${blockKey}_tasks.yaml`;
          // Simplify tasks: extract system prompts to separate files
          const simplifiedTasks: Record<string, unknown>[] = [];
          for (let ti = 0; ti < tasks.length; ti++) {
            const t = tasks[ti] as Record<string, unknown>;
            const msg = t.message as Record<string, unknown> || {};
            const system = msg.system as string || '';
            const user = msg.user as string || '';
            const taskTitle = t.title as string || `Task ${ti}`;

            const taskEntry: Record<string, unknown> = { title: taskTitle };
            if (user) taskEntry.user = user;
            if (system) {
              const sysFname = `${prefix || 'page'}_${blockKey}_task${ti}.md`;
              safeWrite(path.join(aiDir, sysFname), system);
              taskEntry.system_file = `./ai/${sysFname}`;
            }
            taskEntry.autoSend = t.autoSend ?? true;
            simplifiedTasks.push(taskEntry);
          }
          safeWrite(path.join(aiDir, tasksFname), dumpYaml({ tasks: simplifiedTasks }));
          actionSpec.tasks_file = `./ai/${tasksFname}`;
        }
        target.push(actionSpec);
      } else if (atype === 'workflowTrigger') {
        const actionSpec: Record<string, unknown> = { type: atype };
        if (act.stepParams && Object.keys(act.stepParams).length) {
          actionSpec.stepParams = act.stepParams;
        }
        target.push(actionSpec);
      } else {
        // For actions with stepParams (popup buttons, updateRecord, etc.)
        const sp = (act.stepParams || {}) as Record<string, unknown>;
        const props = (act as unknown as Record<string, unknown>).props as Record<string, unknown>;
        const hasConfig = Object.keys(sp).length > 0 || (props && Object.keys(props).length > 0);

        if (hasConfig && ['popup', 'updateRecord', 'duplicate'].includes(atype)) {
          const actionSpec: Record<string, unknown> = { type: atype };
          if (Object.keys(sp).length) actionSpec.stepParams = sp;
          if (props && Object.keys(props).length) actionSpec.props = props;
          target.push(actionSpec);
        } else {
          target.push(atype);
        }
      }

      // Check for popup (ChildPage under action)
      if (act.subModels?.page) {
        actionPopups.push({
          field: atype,
          field_uid: act.uid,
          block_key: blockKey,
          target: `$SELF.${blockKey}.${subKey === 'recordActions' ? 'record_actions' : 'actions'}.${atype}`,
        });
      }
    }

    // Also check TableActionsColumn for record actions
    if (subKey === 'recordActions') {
      const cols = item.subModels?.columns;
      const colArr = (Array.isArray(cols) ? cols : []) as FlowModelNode[];
      for (const col of colArr) {
        if (!col.use?.includes('TableActionsColumn')) continue;
        const colActs = col.subModels?.actions;
        const colActArr = (Array.isArray(colActs) ? colActs : []) as FlowModelNode[];
        for (const act of colActArr) {
          const atype = ACTION_TYPE_MAP[act.use || ''];
          if (!atype) continue;
          if (!recordActions.includes(atype)) recordActions.push(atype);
          if (act.subModels?.page) {
            actionPopups.push({ field: atype, field_uid: act.uid, block_key: blockKey });
          }
        }
      }
    }
  }

  return { actions, recordActions, actionPopups };
}
