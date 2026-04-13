/**
 * Deploy JS items (inside detail/form grid) and JS columns (table).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { NocoBaseClient } from '../../client';
import type { BlockSpec } from '../../types/spec';
import type { BlockState } from '../../types/state';
import type { LogFn } from './types';
import { ensureJsHeader, replaceJsUids } from '../../utils/js-utils';
import { generateUid } from '../../utils/uid';

/**
 * Deploy JS items into a form/details grid.
 */
export async function deployJsItems(
  nb: NocoBaseClient,
  gridUid: string,
  bs: BlockSpec,
  coll: string,
  modDir: string,
  blockState: BlockState,
  allBlocksState: Record<string, BlockState>,
  log: LogFn,
): Promise<void> {
  const jsItems = bs.js_items || [];
  if (!jsItems.length || !gridUid) return;

  for (const jsSpec of jsItems) {
    if (!jsSpec.file) continue;
    const jsPath = path.join(modDir, jsSpec.file);
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

/**
 * Deploy JS columns into a table block.
 */
export async function deployJsColumns(
  nb: NocoBaseClient,
  blockUid: string,
  bs: BlockSpec,
  coll: string,
  modDir: string,
  blockState: BlockState,
  allBlocksState: Record<string, BlockState>,
  log: LogFn,
): Promise<void> {
  const jsCols = bs.js_columns || [];
  if (!jsCols.length || bs.type !== 'table') return;

  for (const jsSpec of jsCols) {
    if (!jsSpec.file) continue;
    const jsPath = path.join(modDir, jsSpec.file);
    if (!fs.existsSync(jsPath)) continue;

    let code = fs.readFileSync(jsPath, 'utf8');
    code = ensureJsHeader(code, { desc: jsSpec.desc, jsType: 'JSColumnModel', coll });

    const existing = blockState.js_columns?.[jsSpec.key];
    if (existing?.uid) {
      const colUpdate: Record<string, unknown> = {
        jsSettings: { runJs: { code, version: 'v1' } },
      };
      if (jsSpec.title) colUpdate.tableColumnSettings = { title: { title: jsSpec.title } };
      await nb.updateModel(existing.uid, colUpdate);
    } else {
      const newUid = generateUid();
      const colStepParams: Record<string, unknown> = {
        jsSettings: { runJs: { code, version: 'v1' } },
        fieldSettings: { init: { fieldPath: jsSpec.field } },
      };
      if (jsSpec.title) {
        colStepParams.tableColumnSettings = { title: { title: jsSpec.title } };
      }
      await nb.models.save({
        uid: newUid, use: 'JSColumnModel',
        parentId: blockUid, subKey: 'columns', subType: 'array',
        sortIndex: 0, flowRegistry: {},
        stepParams: colStepParams,
      });
      if (!blockState.js_columns) blockState.js_columns = {};
      blockState.js_columns[jsSpec.key] = { uid: newUid };
    }
    log(`      ~ JS col: ${jsSpec.desc || jsSpec.key}`);
  }
}
