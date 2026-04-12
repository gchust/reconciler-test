/**
 * Deploy clickToOpen popups on table fields.
 *
 * Priority order:
 *   1. Inline popup content (from template export) → deploySurface
 *   2. Popup already deployed (by popup-deployer) → skip
 *   3. Template copy mode → read template → deploySurface
 *   4. Circular reference / max depth → simple details fallback
 *   5. Default details → compose basic details block
 *
 * ⚠️ PITFALLS:
 * - popupSettings.uid must point to FIELD uid (NocoBase resolves field → page)
 * - Must check existing popup blockCount vs spec blockCount to avoid overwriting
 * - See src/PITFALLS.md for complete list.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { NocoBaseClient } from '../../client';
import type { BlockSpec } from '../../types/spec';
import type { BlockState } from '../../types/state';
import type { LogFn, PopupContext } from './types';
import { loadTemplateContent } from './template-loader';

export async function deployClickToOpen(
  nb: NocoBaseClient,
  bs: BlockSpec,
  coll: string,
  fieldStates: Record<string, { wrapper: string; field?: string }>,
  modDir: string,
  allBlocksState: Record<string, BlockState>,
  popupContext: PopupContext,
  log: LogFn,
): Promise<void> {
  if (bs.type !== 'table') return;

  const mod = path.resolve(modDir);

  for (const f of bs.fields || []) {
    if (typeof f !== 'object' || !f.clickToOpen) continue;
    const fp = f.field || f.fieldPath || '';
    const wrapperUid = fieldStates[fp]?.wrapper;
    if (!wrapperUid) continue;

    try {
      const colData = await nb.get({ uid: wrapperUid });
      const fieldSub = colData.tree.subModels?.field;
      if (!fieldSub || Array.isArray(fieldSub)) continue;

      const fieldUid = (fieldSub as { uid: string }).uid;
      const update: Record<string, unknown> = {
        displayFieldSettings: { clickToOpen: { clickToOpen: true } },
      };

      const ps = (f as unknown as Record<string, unknown>).popupSettings as Record<string, unknown>;
      const inlinePopup = (f as unknown as Record<string, unknown>).popup as Record<string, unknown>;

      if (ps || inlinePopup) {
        const popupColl = ((ps?.collectionName || inlinePopup?.collectionName || coll) as string) || coll;

        // ── Path 1: Inline popup content (highest priority) ──
        if (inlinePopup && (inlinePopup.blocks || inlinePopup.tabs)) {
          await deployInlinePopup(nb, fieldUid, fp, inlinePopup, ps, popupColl, coll, mod, popupContext, log);
          continue;
        }

        // ── Path 2: Check if popup already deployed ──
        const alreadyDeployed = await checkExistingPopup(nb, fieldUid);
        if (alreadyDeployed) {
          update.popupSettings = makePopupSettings(fieldUid, popupColl, ps);
          log(`      ~ clickToOpen: ${fp} (popup already deployed)`);
          await nb.updateModel(fieldUid, update);
          continue;
        }

        // ── Path 3/4/5: Circular, template copy, or default ──
        const isCircular = popupContext.seenColls.has(popupColl);
        const atMaxDepth = popupContext.depth >= popupContext.maxDepth;

        if (isCircular || atMaxDepth) {
          // Circular reference or max depth → simple details (no recursion)
          log(`      ~ clickToOpen: ${fp} (depth=${popupContext.depth}, ${isCircular ? 'circular: ' + popupColl : 'max depth'})`);
          await deployDefaultDetails(nb, fieldUid, popupColl);
          update.popupSettings = makePopupSettings(fieldUid, popupColl, ps);
        } else {
          // Template copy mode or default
          const tplContent = await loadTemplateContent(nb, modDir, ps?.popupTemplateUid as string, popupColl);
          const childCtx = makeChildContext(popupContext, coll);

          if (tplContent.length) {
            const { deploySurface } = await import('../surface-deployer');
            let tplDir = mod;
            for (let d = mod; d !== path.dirname(d); d = path.dirname(d)) {
              if (fs.existsSync(path.join(d, 'templates'))) { tplDir = d; break; }
            }
            try {
              await deploySurface(nb, fieldUid,
                { blocks: tplContent as any[], coll: popupColl } as any,
                tplDir, false, {}, log, childCtx);
            } catch (e) {
              log(`      ! clickToOpen ${fp} template: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
            }
            log(`      ~ clickToOpen: ${fp} (copy: ${tplContent.length} blocks, depth=${popupContext.depth})`);
          } else {
            await deployDefaultDetails(nb, fieldUid, popupColl);
            log(`      ~ clickToOpen: ${fp} (default details)`);
          }
          update.popupSettings = makePopupSettings(fieldUid, popupColl, ps);
        }
      }

      await nb.updateModel(fieldUid, update);
      log(`      ~ clickToOpen: ${fp}`);
    } catch (e) {
      log(`      ! clickToOpen ${fp}: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
    }
  }
}

// ── Internal helpers ──

async function deployInlinePopup(
  nb: NocoBaseClient,
  fieldUid: string,
  fp: string,
  inlinePopup: Record<string, unknown>,
  ps: Record<string, unknown> | undefined,
  popupColl: string,
  parentColl: string,
  mod: string,
  popupContext: PopupContext,
  log: LogFn,
): Promise<void> {
  const childCtx = makeChildContext(popupContext, parentColl);

  // Find correct modDir for template JS files
  let popupModDir = mod;
  const templateName = inlinePopup._template as string;
  if (templateName) {
    popupModDir = resolveTemplateDir(mod, templateName) || mod;
  }

  const popupTabs = inlinePopup.tabs as Record<string, unknown>[];
  const popupBlocks = inlinePopup.blocks as Record<string, unknown>[];

  if (popupTabs?.length) {
    // Multi-tab popup → use deployPopup
    const { deployPopup } = await import('../popup-deployer');
    await deployPopup(nb, fieldUid, `${fp}.popup`, {
      target: '',
      mode: (inlinePopup.mode || ps?.mode || 'drawer') as 'drawer' | 'dialog',
      coll: popupColl,
      tabs: popupTabs.map(t => ({
        title: t.title as string,
        blocks: (t.blocks || []) as any[],
      })),
    }, popupModDir, false, '', log);
  } else if (popupBlocks?.length) {
    const { deploySurface } = await import('../surface-deployer');
    try {
      await deploySurface(nb, fieldUid,
        { blocks: popupBlocks as any[], coll: popupColl } as any,
        popupModDir, false, {}, log, childCtx);
    } catch (e) {
      log(`      ! inline popup ${fp}: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
    }
  }

  const update: Record<string, unknown> = {
    displayFieldSettings: { clickToOpen: { clickToOpen: true } },
    popupSettings: {
      openView: {
        collectionName: popupColl, dataSourceKey: 'main',
        mode: (inlinePopup.mode || ps?.mode || 'drawer') as string,
        size: (inlinePopup.size || ps?.size || 'medium') as string,
        pageModelClass: 'ChildPageModel', uid: fieldUid,
        filterByTk: (ps?.filterByTk || '{{ ctx.record.id }}') as string,
      },
    },
  };
  log(`      ~ clickToOpen: ${fp} (inline popup: ${popupTabs?.length || 0} tabs, ${popupBlocks?.length || 0} blocks)`);
  await nb.updateModel(fieldUid, update);
}

async function checkExistingPopup(nb: NocoBaseClient, fieldUid: string): Promise<boolean> {
  try {
    const fieldCheck = await nb.get({ uid: fieldUid });
    const existingPage = fieldCheck.tree.subModels?.page;
    if (!existingPage || Array.isArray(existingPage)) return false;

    const existingTabs = (existingPage as any).subModels?.tabs;
    const tabArr = Array.isArray(existingTabs) ? existingTabs : existingTabs ? [existingTabs] : [];
    let blockCount = 0;
    for (const t of tabArr as any[]) {
      const items = t.subModels?.grid?.subModels?.items;
      blockCount += Array.isArray(items) ? items.length : 0;
    }
    return blockCount > 1; // more than default 1 block
  } catch {
    return false;
  }
}

async function deployDefaultDetails(
  nb: NocoBaseClient,
  fieldUid: string,
  popupColl: string,
): Promise<void> {
  try {
    const meta = await nb.collections.fieldMeta(popupColl);
    const defaultFields = Object.keys(meta)
      .filter(k => !['id', 'createdById', 'updatedById'].includes(k))
      .slice(0, 8)
      .map(k => ({ fieldPath: k }));
    await nb.surfaces.compose(fieldUid, [{
      key: 'details', type: 'details',
      resource: { collectionName: popupColl, dataSourceKey: 'main', binding: 'currentRecord' },
      fields: defaultFields,
    }], 'replace');
  } catch { /* default details is best-effort */ }
}

function makePopupSettings(
  fieldUid: string,
  popupColl: string,
  ps?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    openView: {
      collectionName: popupColl,
      dataSourceKey: 'main',
      mode: ps?.mode || 'drawer',
      size: ps?.size || 'medium',
      pageModelClass: 'ChildPageModel',
      uid: fieldUid,
      filterByTk: ps?.filterByTk || '{{ ctx.record.id }}',
    },
  };
}

function makeChildContext(parent: PopupContext, coll: string): PopupContext {
  return {
    depth: parent.depth + 1,
    maxDepth: parent.maxDepth,
    seenColls: new Set([...parent.seenColls, coll]),
  };
}

function resolveTemplateDir(mod: string, templateName: string): string | null {
  for (let d = mod; d !== path.dirname(d); d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'templates'))) {
      const slugName = templateName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      for (const tplType of ['popup', 'block']) {
        const candidate = path.join(d, 'templates', tplType, slugName);
        if (fs.existsSync(path.join(candidate, 'js'))) return candidate;
        // Legacy: templates/popup/<slug>_js/ (old format)
        const legacyCandidate = path.join(d, 'templates', tplType, `${slugName}_js`);
        if (fs.existsSync(legacyCandidate)) {
          const jsSubDir = path.join(legacyCandidate, 'js');
          if (!fs.existsSync(jsSubDir)) {
            fs.mkdirSync(jsSubDir, { recursive: true });
            for (const f of fs.readdirSync(legacyCandidate)) {
              if (f.endsWith('.js')) {
                fs.copyFileSync(path.join(legacyCandidate, f), path.join(jsSubDir, f));
              }
            }
          }
          return legacyCandidate;
        }
      }
      return null;
    }
  }
  return null;
}
