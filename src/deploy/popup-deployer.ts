/**
 * Deploy popups — simple, tabbed, and nested.
 *
 * ⚠️ PITFALLS:
 * - compose target for popup tab: use ChildPage TAB uid (not field/action uid)
 * - hasContent check: compare live blockCount vs spec blockCount (not just >0)
 * - popupSettings.uid must point to field itself (NocoBase resolves field → page)
 * - See src/PITFALLS.md for complete list.
 */
import type { NocoBaseClient } from '../client';
import type { PopupSpec, BlockSpec } from '../types/spec';
import type { BlockState } from '../types/state';
import { deploySurface } from './surface-deployer';

/**
 * Deploy a single popup onto a target (action, field column, etc.).
 */
export async function deployPopup(
  nb: NocoBaseClient,
  targetUid: string,
  targetRef: string,
  popupSpec: PopupSpec,
  modDir: string,
  force = false,
  popupPath = '',
  log: (msg: string) => void = console.log,
  existingPopupBlocks: Record<string, BlockState> = {},
): Promise<Record<string, BlockState>> {
  const mode = popupSpec.mode || 'drawer';
  const coll = popupSpec.coll || '';
  const tabsSpec = popupSpec.tabs;

  // Check if popup already has content
  try {
    const data = await nb.get({ uid: targetUid });
    const tree = data.tree;
    const popupPage = tree.subModels?.page;
    if (popupPage && !Array.isArray(popupPage)) {
      const tabs = (popupPage as unknown as unknown as Record<string, unknown>).subModels as Record<string, unknown>;
      const tabList = tabs?.tabs;
      const tabArr = Array.isArray(tabList) ? tabList : tabList ? [tabList] : [];
      // Check if popup has ENOUGH content (matches spec tab/block count)
      const specTabCount = tabsSpec ? tabsSpec.length : 1;
      const specBlockCount = tabsSpec
        ? tabsSpec.reduce((n, t) => n + ((t.blocks || []).length), 0)
        : (popupSpec.blocks || []).length;

      let liveBlockCount = 0;
      for (const t of tabArr) {
        const g = (t as unknown as Record<string, unknown>).subModels as Record<string, unknown>;
        const gridObj = g?.grid as Record<string, unknown>;
        const items = gridObj?.subModels as Record<string, unknown>;
        const itemArr = items?.items;
        if (Array.isArray(itemArr)) liveBlockCount += itemArr.length;
      }

      // Content is sufficient if live has at least as many tabs and blocks as spec
      const hasContent = tabArr.length >= specTabCount && liveBlockCount >= specBlockCount && liveBlockCount > 0;
      if (hasContent) {
        // Popup exists — sync content only (fillBlock for JS, templateRef, etc.)
        // Do NOT re-compose: just update existing blocks in-place by position
        log(`  = popup [${targetRef}] (exists, sync content)`);
        const blocks = popupSpec.blocks || (tabsSpec ? tabsSpec[0]?.blocks : []) || [];
        const popupLayout = popupSpec.layout || (tabsSpec ? tabsSpec[0]?.layout : undefined);

        if (blocks.length) {
          // Use state-based key→uid mapping (from previous deploy)
          // Falls back to deploySurface if no state exists
          if (Object.keys(existingPopupBlocks).length) {
            const { fillBlock } = await import('./block-filler');
            const blocksState = { ...existingPopupBlocks };
            for (const bs of blocks) {
              const key = bs.key || bs.type;
              const existing = blocksState[key];
              if (!existing?.uid) continue;
              await fillBlock(nb, existing.uid, existing.grid_uid || '', bs, coll, modDir, existing, blocksState, '', log);
            }
            // Apply layout
            if (popupLayout) {
              const { parseLayoutSpec, applyLayout } = await import('../layout/layout-engine');
              const tg0 = (tabArr[0] as unknown as Record<string, unknown>).subModels as Record<string, unknown>;
              const gridUid = (tg0?.grid as Record<string, unknown>)?.uid as string || '';
              if (gridUid) {
                const uidMap: Record<string, string> = {};
                for (const [k, v] of Object.entries(blocksState)) {
                  if (v.uid) uidMap[k] = v.uid;
                }
                const layout = parseLayoutSpec(popupLayout as any[], Object.keys(uidMap));
                await applyLayout(nb, gridUid, layout, uidMap);
              }
            }
            return blocksState;
          }
          // No state → full deploy via deploySurface
          const syncResult = await deploySurface(
            nb, targetUid, { blocks, coll, layout: popupLayout } as any, modDir, false, {}, log,
          );
          return syncResult;
        }
        return {};
      }
    }
  } catch (e) {
    log(`  ! popup check [${targetRef}]: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
  }

  // Set click-to-open settings
  await nb.updateModel(targetUid, {
    popupSettings: {
      openView: {
        collectionName: coll,
        dataSourceKey: 'main',
        mode,
        size: 'large',
        pageModelClass: 'ChildPageModel',
        uid: targetUid,
      },
    },
    displayFieldSettings: {
      clickToOpen: { clickToOpen: true },
    },
  });

  let result: Record<string, BlockState> = {};
  if (tabsSpec) {
    result = await deployTabbedPopup(nb, targetUid, targetRef, tabsSpec, coll, modDir, force, popupPath, log);
  } else {
    const blocks = popupSpec.blocks || [];
    if (blocks.length) {
      result = await deploySimplePopup(nb, targetUid, targetRef, popupSpec, coll, modDir, log);
    }
  }
  return result;
}

async function deploySimplePopup(
  nb: NocoBaseClient,
  targetUid: string,
  targetRef: string,
  popupSpec: PopupSpec,
  coll: string,
  modDir: string,
  log: (msg: string) => void,
): Promise<Record<string, BlockState>> {
  const spec = {
    coll,
    blocks: popupSpec.blocks || [],
    layout: popupSpec.layout,
  };
  const blocksState = await deploySurface(nb, targetUid, spec as any, modDir, false, {}, log);
  log(`  + popup [${targetRef}]: ${Object.keys(blocksState).length} blocks`);
  return blocksState;
}

async function deployTabbedPopup(
  nb: NocoBaseClient,
  targetUid: string,
  targetRef: string,
  tabsSpec: NonNullable<PopupSpec['tabs']>,
  coll: string,
  modDir: string,
  force: boolean,
  popupPath: string,
  log: (msg: string) => void,
): Promise<Record<string, BlockState>> {
  log(`  + popup [${targetRef}]: ${tabsSpec.length} tabs`);
  const allBlocks: Record<string, BlockState> = {};

  // ── Step 1: Find ChildPage + first tab UID ──
  // ChildPage may be on target (.page) or on target.field (.field.page) for table columns
  let existingTabs: { uid: string }[] = [];
  let popupPageUid = '';
  let firstTabUid = '';
  try {
    const data = await nb.get({ uid: targetUid });
    let pp = data.tree.subModels?.page;
    if ((!pp || Array.isArray(pp)) && data.tree.subModels?.field) {
      const field = data.tree.subModels.field;
      if (field && !Array.isArray(field)) {
        pp = ((field as unknown as Record<string, unknown>).subModels as Record<string, unknown>)?.page as typeof pp;
      }
    }
    if (pp && !Array.isArray(pp)) {
      popupPageUid = (pp as unknown as Record<string, unknown>).uid as string || '';
      const subs = (pp as unknown as Record<string, unknown>).subModels as Record<string, unknown>;
      const tl = subs?.tabs;
      existingTabs = (Array.isArray(tl) ? tl : tl ? [tl] : []) as { uid: string }[];
      if (existingTabs.length) {
        firstTabUid = existingTabs[0].uid || '';
      }
    }
  } catch (e) {
    log(`    ! read popup tabs: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
  }

  // If no ChildPage exists yet, compose to targetUid to trigger creation
  if (!popupPageUid) {
    const firstTabSpec = tabsSpec[0];
    const firstTabBlocks = await deploySurface(
      nb, targetUid, { ...firstTabSpec, coll } as any, modDir, false, {}, log,
    );
    Object.assign(allBlocks, firstTabBlocks);
    log(`    tab '${firstTabSpec.title || 'Tab0'}': ${Object.keys(firstTabBlocks).length} blocks`);

    if (tabsSpec.length <= 1) return allBlocks;

    // Re-read ChildPage after compose
    try {
      const data = await nb.get({ uid: targetUid });
      let pp = data.tree.subModels?.page;
      if ((!pp || Array.isArray(pp)) && data.tree.subModels?.field) {
        const field = data.tree.subModels.field;
        if (field && !Array.isArray(field)) {
          pp = ((field as unknown as Record<string, unknown>).subModels as Record<string, unknown>)?.page as typeof pp;
        }
      }
      if (pp && !Array.isArray(pp)) {
        popupPageUid = (pp as unknown as Record<string, unknown>).uid as string || '';
        const subs = (pp as unknown as Record<string, unknown>).subModels as Record<string, unknown>;
        const tl = subs?.tabs;
        existingTabs = (Array.isArray(tl) ? tl : tl ? [tl] : []) as { uid: string }[];
      }
    } catch { /* skip */ }

    if (!popupPageUid) {
      log(`    ! popup [${targetRef}]: ChildPage not found — cannot create additional tabs`);
      return allBlocks;
    }
  } else {
    // ChildPage already exists — compose first tab to its tab UID (not targetUid)
    const composeTarget = firstTabUid || targetUid;
    const firstTabSpec = tabsSpec[0];
    const firstTabBlocks = await deploySurface(
      nb, composeTarget, { ...firstTabSpec, coll } as any, modDir, false, {}, log,
    );
    Object.assign(allBlocks, firstTabBlocks);
    log(`    tab '${firstTabSpec.title || 'Tab0'}': ${Object.keys(firstTabBlocks).length} blocks`);

    if (tabsSpec.length <= 1) return allBlocks;
  }

  // ── Step 3: Deploy remaining tabs via addPopupTab ──
  for (let i = 1; i < tabsSpec.length; i++) {
    const tabSpec = tabsSpec[i];
    const tabTitle = tabSpec.title || `Tab${i}`;
    let tabUid: string;

    if (i < existingTabs.length) {
      // Use existing tab UID
      tabUid = existingTabs[i].uid;
    } else {
      // Create new popup tab
      try {
        const result = await nb.surfaces.addPopupTab(popupPageUid, tabTitle);
        const r = result as Record<string, unknown>;
        tabUid = (r.popupTabUid || r.tabSchemaUid || r.tabUid || r.uid || '') as string;
        if (!tabUid) {
          log(`    ! tab '${tabTitle}': addPopupTab returned no UID`);
          continue;
        }
      } catch (e) {
        log(`    ! tab '${tabTitle}': ${e instanceof Error ? e.message : e}`);
        continue;
      }
    }

    const tabBlocks = await deploySurface(nb, tabUid, { ...tabSpec, coll } as any, modDir, false, {}, log);
    Object.assign(allBlocks, tabBlocks);
    log(`    tab '${tabTitle}': ${Object.keys(tabBlocks).length} blocks`);
  }
  return allBlocks;
}
