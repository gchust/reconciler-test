/**
 * Expand YAML sugar syntax to full spec format.
 * Called once during spec loading, before deploy pipeline.
 *
 * Sugar is backwards-compatible: full format passes through unchanged.
 * Idempotent: expanding already-expanded spec produces the same result.
 *
 * Sugar rules:
 *   1. Block sugar: `js:` and `ref:` shorthand for jsBlock/reference blocks
 *   2. Field sugar: `popup:` shorthand for clickToOpen + popupSettings
 *   3. Action sugar: `link:`, `ai:`, `updateRecord:` shorthand
 *   4. Filter sugar: `filter:` shorthand for dataScope
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadYaml } from '../utils/yaml';
import { slugify } from '../utils/slugify';

// ── Public API ──

/** Expand all sugar in a page spec. */
export function expandPageSugar(
  spec: Record<string, unknown>,
  projectRoot: string,
): Record<string, unknown> {
  const result = { ...spec };

  // Expand blocks
  if (Array.isArray(result.blocks)) {
    result.blocks = expandBlockList(result.blocks, projectRoot, result.coll as string | undefined);
  }

  // Expand tabs
  if (Array.isArray(result.tabs)) {
    result.tabs = (result.tabs as Record<string, unknown>[]).map(tab => {
      const t = { ...tab };
      if (Array.isArray(t.blocks)) {
        t.blocks = expandBlockList(t.blocks, projectRoot, (t.coll || result.coll) as string | undefined);
      }
      // Expand popups inside tabs
      if (Array.isArray(t.popups)) {
        t.popups = (t.popups as Record<string, unknown>[]).map(p =>
          expandPopupSugar(p, projectRoot),
        );
      }
      return t;
    });
  }

  return result;
}

/** Expand all sugar in a popup spec. */
export function expandPopupSugar(
  spec: Record<string, unknown>,
  projectRoot: string,
): Record<string, unknown> {
  const result = { ...spec };

  // Expand blocks
  if (Array.isArray(result.blocks)) {
    result.blocks = expandBlockList(result.blocks, projectRoot, result.coll as string | undefined);
  }

  // Expand tabs
  if (Array.isArray(result.tabs)) {
    result.tabs = (result.tabs as Record<string, unknown>[]).map(tab => {
      const t = { ...tab };
      if (Array.isArray(t.blocks)) {
        t.blocks = expandBlockList(t.blocks, projectRoot, (t.coll || result.coll) as string | undefined);
      }
      return t;
    });
  }

  return result;
}

// ── Block list expansion ──

function expandBlockList(
  blocks: unknown[],
  projectRoot: string,
  parentColl?: string,
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const b of blocks) {
    if (b && typeof b === 'object' && !Array.isArray(b)) {
      const block = b as Record<string, unknown>;
      const expanded = expandSingleBlock(block, projectRoot, parentColl);
      result.push(...expanded);
    } else {
      // Pass through non-object entries unchanged
      result.push(b as Record<string, unknown>);
    }
  }
  return result;
}

/**
 * Expand a single block entry. May return 1 block (normal) or 1 block
 * from sugar expansion.
 */
function expandSingleBlock(
  block: Record<string, unknown>,
  projectRoot: string,
  parentColl?: string,
): Record<string, unknown>[] {
  // ── Sugar 1: js: shorthand ──
  if ('js' in block && !('type' in block)) {
    return [expandJsSugar(block)];
  }

  // ── Sugar 1: ref: shorthand ──
  if ('ref' in block && !('type' in block)) {
    return [expandRefSugar(block, projectRoot)];
  }

  // Otherwise, process the block normally — expand its internals
  const result = { ...block };

  // Determine block collection for field popup expansion
  const blockColl = (result.coll || parentColl || '') as string;

  // Expand field sugar (popup:)
  if (Array.isArray(result.fields)) {
    result.fields = expandFieldList(result.fields, projectRoot, blockColl);
  }

  // Expand action sugar (link:, ai:, updateRecord:)
  if (Array.isArray(result.actions)) {
    result.actions = expandActionList(result.actions);
  }
  if (Array.isArray(result.recordActions)) {
    result.recordActions = expandActionList(result.recordActions);
  }

  // Expand filter sugar
  if (result.filter && !result.dataScope) {
    result.dataScope = expandFilterSugar(result.filter as Record<string, unknown>);
    delete result.filter;
  }

  // Recurse into popups
  if (Array.isArray(result.popups)) {
    result.popups = (result.popups as Record<string, unknown>[]).map(p =>
      expandPopupSugar(p, projectRoot),
    );
  }

  // Recurse into tabs
  if (Array.isArray(result.tabs)) {
    result.tabs = (result.tabs as Record<string, unknown>[]).map(tab => {
      const t = { ...tab };
      if (Array.isArray(t.blocks)) {
        t.blocks = expandBlockList(t.blocks, projectRoot, (t.coll || blockColl) as string | undefined);
      }
      return t;
    });
  }

  return [result];
}

// ── Sugar 1: js: shorthand ──

function expandJsSugar(block: Record<string, unknown>): Record<string, unknown> {
  const jsVal = block.js;

  if (typeof jsVal === 'string') {
    // js: ./js/overview_header.js
    const filename = path.basename(jsVal, path.extname(jsVal));
    return {
      key: slugify(filename),
      type: 'jsBlock',
      file: jsVal,
    };
  }

  if (jsVal && typeof jsVal === 'object' && !Array.isArray(jsVal)) {
    // js: { file: ./js/xxx.js, desc: Calendar Block }
    const jsObj = jsVal as Record<string, unknown>;
    const file = jsObj.file as string || '';
    const desc = jsObj.desc as string || '';
    const filename = path.basename(file, path.extname(file));
    const key = desc ? slugify(desc) : slugify(filename);
    return {
      key,
      type: 'jsBlock',
      desc: desc || undefined,
      file,
    };
  }

  // Fallback: pass through
  return block;
}

// ── Sugar 1: ref: shorthand ──

function expandRefSugar(
  block: Record<string, unknown>,
  projectRoot: string,
): Record<string, unknown> {
  const refPath = block.ref as string;
  if (!refPath) return block;

  const absPath = path.resolve(projectRoot, refPath);
  if (!fs.existsSync(absPath)) {
    // File not found — return a stub with the path for error reporting
    return {
      key: 'reference',
      type: 'reference',
      _refError: `Template file not found: ${absPath}`,
    };
  }

  try {
    const template = loadYaml<Record<string, unknown>>(absPath);
    return {
      key: (template.key as string) || 'reference',
      type: 'reference',
      templateRef: {
        templateUid: template.templateUid || template.uid || '',
        templateName: template.templateName || template.name || '',
        targetUid: template.targetUid || '',
        mode: template.mode || 'reference',
      },
    };
  } catch {
    return {
      key: 'reference',
      type: 'reference',
      _refError: `Failed to parse template file: ${absPath}`,
    };
  }
}

// ── Sugar 2: Field popup: shorthand ──

function expandFieldList(
  fields: unknown[],
  projectRoot: string,
  blockColl: string,
): unknown[] {
  return fields.map(f => {
    if (!f || typeof f !== 'object' || Array.isArray(f)) return f;
    const field = f as Record<string, unknown>;
    if (!('popup' in field)) return field;

    return expandPopupFieldSugar(field, projectRoot, blockColl);
  });
}

function expandPopupFieldSugar(
  field: Record<string, unknown>,
  projectRoot: string,
  blockColl: string,
): Record<string, unknown> {
  const popupVal = field.popup;
  const result = { ...field };
  delete result.popup;

  result.clickToOpen = true;

  if (popupVal === true) {
    // popup: true → default popup settings
    result.popupSettings = {
      collectionName: blockColl || undefined,
      mode: 'drawer',
      size: 'large',
      filterByTk: '{{ ctx.record.id }}',
    };
    return result;
  }

  if (typeof popupVal === 'string') {
    // popup: templates/popup/leads_view.yaml → popup template ref
    const absPath = path.resolve(projectRoot, popupVal);
    if (fs.existsSync(absPath)) {
      try {
        const template = loadYaml<Record<string, unknown>>(absPath);
        result.popupSettings = {
          popupTemplateUid: template.templateUid || template.uid || '',
          collectionName: (template.collectionName || template.coll || blockColl) as string || undefined,
          mode: 'drawer',
          size: 'large',
        };
        return result;
      } catch {
        // Fall through to default
      }
    }
    // Path didn't resolve — treat as template UID directly
    result.popupSettings = {
      popupTemplateUid: popupVal,
      collectionName: blockColl || undefined,
      mode: 'drawer',
      size: 'large',
    };
    return result;
  }

  if (popupVal && typeof popupVal === 'object' && !Array.isArray(popupVal)) {
    // popup: { mode: dialog, size: medium }
    const popupObj = popupVal as Record<string, unknown>;
    result.popupSettings = {
      collectionName: (popupObj.collectionName || blockColl) as string || undefined,
      mode: popupObj.mode || 'drawer',
      size: popupObj.size || 'large',
      filterByTk: (popupObj.filterByTk || '{{ ctx.record.id }}') as string,
    };
    return result;
  }

  // Fallback
  return result;
}

// ── Sugar 3: Action sugar ──

function expandActionList(actions: unknown[]): unknown[] {
  return actions.map(a => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return a;
    const action = a as Record<string, unknown>;

    // Already has type → pass through (full format)
    if ('type' in action) return action;

    // link: shorthand
    if ('link' in action) return expandLinkSugar(action);

    // ai: shorthand
    if ('ai' in action) return expandAiSugar(action);

    // updateRecord: shorthand
    if ('updateRecord' in action) return expandUpdateRecordSugar(action);

    return action;
  });
}

function expandLinkSugar(action: Record<string, unknown>): Record<string, unknown> {
  const linkVal = action.link as Record<string, unknown>;
  if (!linkVal || typeof linkVal !== 'object') return action;

  const title = (linkVal.title || '') as string;
  const icon = (linkVal.icon || '') as string;
  const url = (linkVal.url || '') as string;

  const keySuffix = title ? slugify(title) : 'link';

  return {
    type: 'link',
    key: `link_${keySuffix}`,
    stepParams: {
      buttonSettings: {
        general: {
          title,
          ...(icon ? { icon } : {}),
        },
      },
      linkButtonSettings: {
        editLink: {
          url,
        },
      },
    },
  };
}

function expandAiSugar(action: Record<string, unknown>): Record<string, unknown> {
  const aiVal = action.ai;

  if (typeof aiVal === 'string') {
    // ai: viz
    return {
      type: 'ai',
      employee: aiVal,
      key: `ai_${slugify(aiVal)}`,
    };
  }

  if (aiVal && typeof aiVal === 'object' && !Array.isArray(aiVal)) {
    // ai: { employee: viz, tasks: ./ai/tasks.yaml }
    const aiObj = aiVal as Record<string, unknown>;
    const employee = (aiObj.employee || '') as string;
    const tasks = aiObj.tasks as string | undefined;
    return {
      type: 'ai',
      employee,
      ...(tasks ? { tasks_file: tasks } : {}),
      key: `ai_${slugify(employee)}`,
    };
  }

  return action;
}

function expandUpdateRecordSugar(action: Record<string, unknown>): Record<string, unknown> {
  const spec = action.updateRecord as Record<string, unknown>;
  if (!spec || typeof spec !== 'object') return action;

  const key = (spec.key || 'updateRecord') as string;
  const icon = spec.icon as string | undefined;
  const tooltip = spec.tooltip as string | undefined;
  const title = spec.title as string | undefined;
  const style = spec.style as string | undefined; // 'link' → type: 'link'
  const assign = spec.assign as Record<string, unknown> | undefined;
  const hiddenWhen = spec.hiddenWhen as Record<string, unknown> | undefined;
  const disabledWhen = spec.disabledWhen as Record<string, unknown> | undefined;

  // Build buttonSettings.general
  const general: Record<string, unknown> = {};
  if (style) general.type = style;
  if (icon) general.icon = icon;
  if (title !== undefined) general.title = title;
  else general.title = '';
  if (tooltip) general.tooltip = tooltip;

  // Build linkageRules from hiddenWhen / disabledWhen
  const linkageRules = buildLinkageRules(hiddenWhen, disabledWhen);

  // Build stepParams
  const stepParams: Record<string, unknown> = {
    buttonSettings: {
      general,
      ...(linkageRules ? { linkageRules } : {}),
    },
  };

  // Build assignSettings
  if (assign && Object.keys(assign).length) {
    stepParams.assignSettings = {
      assignFieldValues: {
        assignedValues: assign,
      },
    };
  }

  return {
    type: 'updateRecord',
    key: `updateRecord_${slugify(key)}`,
    stepParams,
  };
}

function buildLinkageRules(
  hiddenWhen?: Record<string, unknown>,
  disabledWhen?: Record<string, unknown>,
): Record<string, unknown> | null {
  const rules: Record<string, unknown>[] = [];

  if (hiddenWhen && Object.keys(hiddenWhen).length) {
    rules.push({
      title: 'Linkage rule',
      enable: true,
      condition: buildCondition(hiddenWhen),
      actions: [{ name: 'linkageSetActionProps', params: { value: 'hidden' } }],
    });
  }

  if (disabledWhen && Object.keys(disabledWhen).length) {
    rules.push({
      title: 'Linkage rule',
      enable: true,
      condition: buildCondition(disabledWhen),
      actions: [{ name: 'linkageSetActionProps', params: { value: 'disabled' } }],
    });
  }

  if (!rules.length) return null;
  return { value: rules };
}

function buildCondition(when: Record<string, unknown>): Record<string, unknown> {
  const items: Record<string, unknown>[] = [];

  for (const [field, value] of Object.entries(when)) {
    // Boolean truthy check
    if (value === true) {
      items.push({
        path: `{{ ctx.record.${field} }}`,
        operator: '$isTruly',
        value: true,
        noValue: true,
      });
    } else if (value === false) {
      items.push({
        path: `{{ ctx.record.${field} }}`,
        operator: '$isFalsy',
        value: false,
        noValue: true,
      });
    } else {
      // Direct value comparison
      items.push({
        path: `{{ ctx.record.${field} }}`,
        operator: '$eq',
        value,
      });
    }
  }

  return { logic: '$and', items };
}

// ── Sugar 4: Filter sugar ──

export function expandFilterSugar(filter: Record<string, unknown>): Record<string, unknown> {
  const items: Record<string, unknown>[] = [];

  for (const [rawKey, value] of Object.entries(filter)) {
    // Parse "field.$operator" or just "field" (defaults to $eq)
    const dotIdx = rawKey.indexOf('.$');
    let fieldPath: string;
    let operator: string;

    if (dotIdx !== -1) {
      fieldPath = rawKey.slice(0, dotIdx);
      operator = rawKey.slice(dotIdx + 1); // includes the $
    } else {
      fieldPath = rawKey;
      operator = '$eq';
    }

    items.push({
      path: fieldPath,
      operator,
      value,
    });
  }

  return {
    logic: '$and',
    items,
  };
}
