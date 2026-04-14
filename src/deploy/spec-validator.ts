/**
 * Pre-deploy spec validation — catch bad DSL patterns BEFORE deployment.
 *
 * These are HARD rules that every AI agent must follow.
 * Errors block deployment. Warnings are logged but don't block.
 */
import type { PageSpec, BlockSpec, PopupSpec } from '../types/spec';
import type { PageInfo } from './page-discovery';

export interface SpecIssue {
  level: 'error' | 'warn';
  page: string;
  block?: string;
  message: string;
}

/**
 * Validate all page specs before deployment.
 * Returns issues found. Errors should block deployment.
 */
export function validatePageSpecs(pages: PageInfo[], projectDir: string): SpecIssue[] {
  const issues: SpecIssue[] = [];

  for (const page of pages) {
    const blocks = page.layout.blocks || [];
    const tabs = page.layout.tabs;
    const allBlocks = tabs
      ? tabs.flatMap(t => t.blocks || [])
      : blocks;

    // Check each block
    for (const bs of allBlocks) {
      validateBlock(bs, page.title, page.popups, issues, projectDir);
    }

    // Check popups
    for (const ps of page.popups) {
      validatePopup(ps, page.title, issues, projectDir);
    }

    // Must have at least addNew popup + detail popup template for main table
    const tableBlocks = allBlocks.filter(b => b.type === 'table');
    for (const tb of tableBlocks) {
      const key = tb.key || 'table';
      const hasAddNew = page.popups.some(p => p.target?.includes(`${key}.actions.addNew`));
      if (!hasAddNew) {
        issues.push({ level: 'error', page: page.title, block: key, message: `table block "${key}" has no addNew popup — create popups/${key}.addNew.yaml` });
      }

      // Must have a detail popup (clickToOpen on some field)
      const fields = tb.fields || [];
      const hasClickToOpen = fields.some(f => {
        if (typeof f === 'object') {
          const fo = f as Record<string, unknown>;
          return fo.clickToOpen || fo.popup;
        }
        return false;
      });
      if (!hasClickToOpen) {
        issues.push({ level: 'error', page: page.title, block: key, message: `table "${key}" has no clickToOpen field — add popup: true to the name/title field` });
      }

      // recordActions should have view + edit
      const recActs = tb.recordActions || [];
      const recTypes = recActs.map(a => typeof a === 'string' ? a : (a as Record<string, unknown>).type as string);
      if (!recTypes.includes('view') && !recTypes.includes('edit')) {
        issues.push({ level: 'warn', page: page.title, block: key, message: `table "${key}" has no view/edit recordActions — add recordActions: [view, edit]` });
      }
    }
  }

  return issues;
}

function validateBlock(bs: BlockSpec, pageTitle: string, popups: PopupSpec[], issues: SpecIssue[], projectDir: string): void {
  const key = bs.key || bs.type;

  // ── Rule 1: filterForm MUST have field_layout (grid) ──
  if (bs.type === 'filterForm') {
    if (!bs.field_layout || !bs.field_layout.length) {
      issues.push({ level: 'error', page: pageTitle, block: key, message: 'filterForm MUST have field_layout with grid layout (e.g. [[field1, field2, field3]])' });
    } else {
      // Check layout quality — no single-field rows (except when only 1 field total)
      const fields = bs.fields || [];
      if (fields.length > 1) {
        for (const row of bs.field_layout) {
          if (Array.isArray(row) && row.length === 1 && typeof row[0] === 'string' && !row[0].startsWith('---') && !row[0].startsWith('[JS:')) {
            const fieldName = row[0];
            // Single input field on its own row is bad layout (unless it's the only search field)
            const isSearchField = typeof fields.find(f =>
              typeof f === 'object' && (f as Record<string, unknown>).field === fieldName && (f as Record<string, unknown>).filterPaths
            ) === 'object';
            if (!isSearchField) {
              issues.push({ level: 'warn', page: pageTitle, block: key, message: `filterForm field "${fieldName}" occupies entire row — combine with other fields (max 3-4 per row)` });
            }
          }
        }
      }
    }

    // ── Rule 2: filterForm should have JS action button group ──
    const jsItems = (bs as Record<string, unknown>).js_items as unknown[];
    if (!Array.isArray(jsItems) || !jsItems.length) {
      issues.push({ level: 'warn', page: pageTitle, block: key, message: 'filterForm has no JS stats button group — consider adding js_items for quick filter stats' });
    }

    // ── Rule 6: filterForm must have filter + reset actions ──
    const actions = bs.actions || [];
    const actionTypes = actions.map(a => typeof a === 'string' ? a : (a as Record<string, unknown>).type as string);
    if (!actionTypes.includes('filter') && !actionTypes.includes('submit')) {
      issues.push({ level: 'warn', page: pageTitle, block: key, message: 'filterForm missing filter/submit action — auto-added' });
    }
    if (!actionTypes.includes('reset')) {
      issues.push({ level: 'warn', page: pageTitle, block: key, message: 'filterForm missing reset action — auto-added' });
    }
  }

  // ── Rule 4: createForm/editForm MUST have field_layout with sections ──
  if (['createForm', 'editForm'].includes(bs.type)) {
    if (!bs.field_layout || !bs.field_layout.length) {
      issues.push({ level: 'error', page: pageTitle, block: key, message: `${bs.type} MUST have field_layout with sections (--- Title ---) and grid layout` });
    } else {
      // Check: must have at least one section divider
      const hasDivider = bs.field_layout.some(row => typeof row === 'string' && row.startsWith('---'));
      if (!hasDivider) {
        issues.push({ level: 'error', page: pageTitle, block: key, message: `${bs.type} field_layout must have at least one section divider (--- Section Name ---)` });
      }
      // Check: no more than 4 fields per row
      for (const row of bs.field_layout) {
        if (Array.isArray(row) && row.length > 4) {
          issues.push({ level: 'warn', page: pageTitle, block: key, message: `${bs.type} row has ${row.length} fields — max 4 per row recommended` });
        }
      }
    }
  }

  // ── Rule 3: filterForm search with filterPaths should combine relation fields ──
  if (bs.type === 'filterForm') {
    const fields = bs.fields || [];
    const searchFields = fields.filter(f => typeof f === 'object' && (f as Record<string, unknown>).filterPaths);
    const plainFields = fields.filter(f => typeof f === 'string' || (typeof f === 'object' && !(f as Record<string, unknown>).filterPaths && !(f as Record<string, unknown>).label));
    // If there's a search field AND a plain relation field that could be merged into filterPaths
    for (const pf of plainFields) {
      const pfName = typeof pf === 'string' ? pf : (pf as Record<string, unknown>).field as string;
      // Common relation fields that should be in filterPaths instead of separate filters
      if (searchFields.length && ['project', 'customer', 'lead', 'contact', 'assignee', 'owner', 'member'].includes(pfName)) {
        issues.push({ level: 'warn', page: pageTitle, block: key, message: `filterForm has separate "${pfName}" filter — consider adding ${pfName}.name to Search filterPaths instead` });
      }
    }
  }
}

function validatePopup(ps: PopupSpec, pageTitle: string, issues: SpecIssue[], projectDir: string): void {
  const blocks = ps.blocks || [];
  const tabs = ps.tabs || [];

  // Check popup form blocks
  for (const bs of blocks) {
    validateBlock(bs, `${pageTitle} popup`, [], issues, projectDir);
  }
  for (const tab of tabs) {
    for (const bs of (tab.blocks || [])) {
      validateBlock(bs, `${pageTitle} popup tab`, [], issues, projectDir);
    }
  }
}
