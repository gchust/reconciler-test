/**
 * Deploy non-compose actions via legacy save_model.
 *
 * These action types are NOT supported by compose API and must be
 * created individually: duplicate, export, import, link, workflowTrigger,
 * ai, expandCollapse, popup, updateRecord.
 */
import type { NocoBaseClient } from '../../client';
import type { BlockSpec } from '../../types/spec';
import type { BlockState } from '../../types/state';
import type { LogFn } from './types';
import { generateUid } from '../../utils/uid';
import { buildAiButton } from './ai-button';
import { actionKey as genActionKey, deduplicateKey } from '../../utils/action-key';

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
  addChild: 'AddChildActionModel',
};

export async function deployNonComposeActions(
  nb: NocoBaseClient,
  blockUid: string,
  bs: BlockSpec,
  blockState: BlockState,
  modDir: string,
  log: LogFn,
): Promise<void> {
  // For table recordActions, find the actCol UID (buttons go under TableActionsColumn, not block root)
  let actColUid = '';
  if (bs.type === 'table' && bs.recordActions?.length) {
    try {
      const tableData = await nb.get({ uid: blockUid });
      const cols = tableData.tree.subModels?.columns;
      const colArr = (Array.isArray(cols) ? cols : []) as { uid: string; use?: string }[];
      const actCol = colArr.find(c => c.use?.includes('TableActionsColumn'));
      if (actCol) actColUid = actCol.uid;
    } catch { /* skip */ }
  }

  // Read live actions to detect existing ones (created by compose/blueprint)
  const liveActionsByUse = new Map<string, string>(); // use → uid
  try {
    const blockData = await nb.get({ uid: blockUid });
    for (const subKey of ['actions', 'recordActions'] as const) {
      const raw = blockData.tree.subModels?.[subKey];
      const arr = (Array.isArray(raw) ? raw : []) as { uid: string; use: string }[];
      for (const a of arr) {
        if (a.use && a.uid) liveActionsByUse.set(a.use, a.uid);
      }
    }
  } catch { /* skip */ }

  const allActions = [...(bs.actions || []), ...(bs.recordActions || [])];
  const usedStateKeys = new Set<string>();

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

    const isRecordAction = (bs.recordActions || []).includes(aspec);
    const stateKey = isRecordAction ? 'record_actions' : 'actions';
    if (!blockState[stateKey]) blockState[stateKey] = {};
    const existingGroup = blockState[stateKey]!;

    // Use semantic key from spec (if present), otherwise generate from type + config
    const specKey = typeof aspec === 'object' ? (aspec as Record<string, unknown>).key as string : undefined;
    const stateActionKey = deduplicateKey(specKey || genActionKey(aspec), usedStateKeys);

    // If already exists in state → update in-place, don't create new
    if (existingGroup[stateActionKey]?.uid) {
      const existingUid = existingGroup[stateActionKey].uid;
      if (Object.keys(actionSp).length || Object.keys(actionProps).length) {
        const update: Record<string, unknown> = { uid: existingUid };
        if (Object.keys(actionSp).length) update.stepParams = actionSp;
        if (Object.keys(actionProps).length) update.props = actionProps;
        await nb.models.save(update);
      }
      continue;
    }

    // Check live tree for existing action with same model type (dedup compose/blueprint)
    const existingLiveUid = liveActionsByUse.get(amodel);
    if (existingLiveUid) {
      // Update existing action with spec config, clear stale props from blueprint defaults
      const update: Record<string, unknown> = { uid: existingLiveUid };
      if (Object.keys(actionSp).length) update.stepParams = actionSp;
      // Always set props — clear blueprint defaults (e.g. {type:"link",title:"Link"}) when spec has none
      update.props = Object.keys(actionProps).length ? actionProps : {};
      await nb.models.save(update);
      existingGroup[stateActionKey] = { uid: existingLiveUid };
      liveActionsByUse.delete(amodel); // consumed — don't reuse for next same-type action
      continue;
    }

    // Determine parentId
    // Table recordActions go under actCol (TableActionsColumnModel), not block root
    const parentId = (isRecordAction && actColUid) ? actColUid : blockUid;
    const desiredSubKey = (isRecordAction && actColUid) ? 'actions' : (isRecordAction ? 'recordActions' : 'actions');

    // Create
    const newUid = generateUid();
    await nb.models.save({
      uid: newUid, use: amodel,
      parentId, subKey: desiredSubKey, subType: 'array',
      sortIndex: 0, stepParams: actionSp, props: actionProps, flowRegistry: {},
    });
    existingGroup[stateActionKey] = { uid: newUid };
  }
}
