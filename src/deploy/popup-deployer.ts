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
        // Popup exists — sync content (fillBlock runs for templateRef, JS, etc.)
        log(`  = popup [${targetRef}] (exists, sync content)`);
        const blocks = popupSpec.blocks || (tabsSpec ? tabsSpec[0]?.blocks : []) || [];
        if (blocks.length) {
          const syncResult = await deploySurface(
            nb, targetUid, { blocks, coll } as any, modDir, false, {}, log,
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

  // ── Step 1: Deploy first tab content to targetUid ──
  // Composing to targetUid triggers NocoBase to auto-create ChildPage + first tab.
  // We MUST do this before trying addPopupTab, or popupPageUid will be empty.
  const firstTabSpec = tabsSpec[0];
  const firstTabBlocks = await deploySurface(
    nb, targetUid, { ...firstTabSpec, coll } as any, modDir, false, {}, log,
  );
  Object.assign(allBlocks, firstTabBlocks);
  log(`    tab '${firstTabSpec.title || 'Tab0'}': ${Object.keys(firstTabBlocks).length} blocks`);

  if (tabsSpec.length <= 1) return allBlocks;

  // ── Step 2: Read ChildPage to get popupPageUid + existing tabs ──
  let existingTabs: { uid: string }[] = [];
  let popupPageUid = '';
  try {
    const data = await nb.get({ uid: targetUid });
    const pp = data.tree.subModels?.page;
    if (pp && !Array.isArray(pp)) {
      popupPageUid = (pp as unknown as Record<string, unknown>).uid as string || '';
      const subs = (pp as unknown as Record<string, unknown>).subModels as Record<string, unknown>;
      const tl = subs?.tabs;
      existingTabs = (Array.isArray(tl) ? tl : tl ? [tl] : []) as { uid: string }[];
    }
  } catch (e) {
    log(`    ! read popup tabs: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
  }

  if (!popupPageUid) {
    log(`    ! popup [${targetRef}]: ChildPage not found after first tab compose — cannot create additional tabs`);
    return allBlocks;
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
