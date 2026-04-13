/**
 * Project-level deployer — deploy from directory structure.
 *
 * Reads:
 *   routes.yaml           → menu tree
 *   collections/*.yaml    → data models
 *   pages/<group>/<page>/ → page.yaml + layout.yaml + popups/ + js/ + charts/
 *
 * Deploy flow:
 *   1. Validate all pages
 *   2. Ensure collections
 *   3. Create routes (groups + pages)
 *   4. Deploy each page surface (blocks + layout)
 *   5. Deploy popups
 *   6. Post-verify
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { NocoBaseClient } from '../client';
import type { ModuleState, PageState, BlockState } from '../types/state';
import type { StructureSpec, PageSpec, BlockSpec, PopupSpec, CollectionDef, EnhanceSpec } from '../types/spec';
import { loadYaml, saveYaml, dumpYaml } from '../utils/yaml';
import { buildGraph } from '../graph/graph-builder';
import { slugify } from '../utils/slugify';
import { ensureCollection } from './collection-deployer';
import { deploySurface } from './surface-deployer';
import { deployPopup } from './popup-deployer';
import { expandPopups } from './popup-expander';
import { deployTemplates, type TemplateUidMap } from './template-deployer';
import { reorderTableColumns } from './column-reorder';
import { postVerify } from './post-verify';
import { verifySqlFromPages } from './sql-verifier';
import { discoverPages, type RouteEntry, type PageInfo } from './page-discovery';
import { RefResolver } from '../refs';
import { pageToBlueprint } from './blueprint-converter';

export async function deployProject(
  projectDir: string,
  opts: { force?: boolean; planOnly?: boolean; group?: string; page?: string; blueprint?: boolean } = {},
  log: (msg: string) => void = console.log,
): Promise<void> {
  const root = path.resolve(projectDir);

  // ── 1. Read project structure ──
  const routesFile = path.join(root, 'routes.yaml');
  if (!fs.existsSync(routesFile)) throw new Error(`routes.yaml not found in ${root}`);
  const routes = loadYaml<RouteEntry[]>(routesFile);

  // Read collections
  const collDefs: Record<string, CollectionDef> = {};
  const collDir = path.join(root, 'collections');
  if (fs.existsSync(collDir)) {
    for (const f of fs.readdirSync(collDir).filter(f => f.endsWith('.yaml'))) {
      const coll = loadYaml<Record<string, unknown>>(path.join(collDir, f));
      const name = (coll.name as string) || f.replace('.yaml', '');
      collDefs[name] = {
        title: (coll.title as string) || name,
        fields: (coll.fields as CollectionDef['fields']) || [],
      };
    }
  }

  // Discover all pages from directory tree
  // --group only controls the target menu group name in NocoBase, not page file discovery
  const pagesDir = path.join(root, 'pages');
  let pages = discoverPages(pagesDir, routes);

  // Filter to single page if specified
  if (opts.page) {
    pages = pages.filter(p =>
      p.title === opts.page || p.slug === slugify(opts.page!)
    );
    if (!pages.length) {
      log(`  Page '${opts.page}' not found`);
      process.exit(1);
    }
    log(`  Deploying single page: ${pages[0].title}`);
  }

  // ── 2. Plan ──
  log('\n  ── Plan ──');
  log(`  Collections: ${Object.keys(collDefs).length}`);
  log(`  Pages: ${pages.length}`);
  for (const p of pages) {
    const blockCount = p.layout.blocks?.length || 0;
    const popupCount = p.popups.length;
    log(`    ${p.title}: ${blockCount} blocks, ${popupCount} popups`);
  }

  // Validation
  let hasError = false;
  for (const p of pages) {
    const blocks = p.layout.blocks || [];
    if (blocks.length > 2 && !p.layout.layout) {
      log(`    ✗ Page '${p.title}' has ${blocks.length} blocks but no layout`);
      hasError = true;
    }
    // Multi-tab: every tab must have a title
    const tabs = p.layout.tabs;
    if (tabs && tabs.length > 1) {
      for (let ti = 0; ti < tabs.length; ti++) {
        if (!tabs[ti].title) {
          log(`    ✗ Page '${p.title}' tab ${ti} has no title`);
          hasError = true;
        }
      }
    }
  }
  if (hasError) { log('\n  Validation failed'); process.exit(1); }
  log('  ✓ Validation passed');

  // ── 2b. Build graph for circular ref detection ──
  const graph = buildGraph(root);
  const graphStats = graph.stats();
  if (graphStats.cycles > 0) {
    log(`  ⚠ ${graphStats.cycles} circular popup references detected — deploy will stop at cycle boundary`);
  }
  log(`  Graph: ${graphStats.nodes} nodes, ${graphStats.edges} edges`);

  if (opts.planOnly) {
    // Generate _refs.yaml in plan mode too
    const nodes = (graph as any).nodes as Map<string, any>;
    for (const [id, n] of nodes) {
      if (n.type !== 'page') continue;
      const refs = graph.pageRefs(id);
      const pageDir = path.join(root, n.meta?.dir || `pages/${n.name}`);
      if (fs.existsSync(pageDir)) {
        saveYaml(path.join(pageDir, '_refs.yaml'), {
          _generated: true, _readonly: 'Auto-generated. Edits will be overwritten.',
          ...refs,
        });
      }
    }
    return;
  }

  // ── 2c. Git snapshot before deploy ──
  gitSnapshot(root, 'pre-deploy', log);

  // ── 3. Connect + deploy ──
  const nb = await NocoBaseClient.create();
  log(`\n  Connected to ${nb.baseUrl}`);

  // State
  const stateFile = path.join(root, 'state.yaml');
  const state: ModuleState = fs.existsSync(stateFile)
    ? loadYaml<ModuleState>(stateFile)
    : { pages: {} };

  // Collections (skip if deploying single page — safety)
  if (!opts.page) {
    for (const [name, def] of Object.entries(collDefs)) {
      await ensureCollection(nb, name, def, log);
    }
  }

  // Deploy templates (before pages, so popupTemplateUid can be mapped)
  let templateUidMap: TemplateUidMap = new Map();
  if (!opts.page) {
    templateUidMap = await deployTemplates(nb, root, log);
  }

  // Routes + pages
  // --group overrides the target group name (e.g. deploy "Main" pages as "CRM Copy")
  const deployedGroups = new Set<string>();
  for (const routeEntry of routes) {
    if (routeEntry.type === 'group') {
      if (deployedGroups.has(routeEntry.title)) continue;
      deployedGroups.add(routeEntry.title);
      // Override group title if --group is specified
      const targetEntry = opts.group
        ? { ...routeEntry, title: opts.group }
        : routeEntry;
      await deployGroup(nb, targetEntry, pages, state, root, opts.force || false, log, opts.blueprint || false);
    } else if (routeEntry.type === 'flowPage' && !opts.group) {
      const pageInfo = pages.find(p => p.title === routeEntry.title);
      if (pageInfo) {
        await deployOnePage(nb, pageInfo, state, null, opts.force || false, log);
      }
    }
  }

  // Final column reorder
  for (const p of pages) {
    const pageKey = slugify(p.title);
    const pageState = state.pages[pageKey];
    for (const bs of p.layout.blocks || []) {
      if (bs.type !== 'table') continue;
      const blockUid = pageState?.blocks?.[bs.key]?.uid;
      const specFields = (bs.fields || []).map(f => typeof f === 'string' ? f : f.field || '').filter(Boolean);
      if (blockUid && specFields.length) await reorderTableColumns(nb, blockUid, specFields);
    }
  }

  // Save state
  saveYaml(stateFile, state);
  log('\n  State saved. Done.');

  // Post-verify — replace $SELF in popup targets before verification
  const allPopups = pages.flatMap(p =>
    p.popups.map(ps => ({
      ...ps,
      target: ps.target.replace('$SELF', `$${slugify(p.title)}`),
    })),
  );
  const structure: StructureSpec = { module: path.basename(root), collections: collDefs, pages: pages.map(p => p.layout) };
  const enhance: EnhanceSpec = { popups: allPopups };
  const resolver = new RefResolver(state);
  const pv = await postVerify(nb, structure, enhance, state, allPopups, ref => resolver.resolveUid(ref));
  if (pv.errors.length) {
    log('\n  ── Post-deploy errors ──');
    for (const e of pv.errors) log(`  ✗ ${e}`);
  }
  if (pv.warnings.length) {
    log('\n  ── Hints ──');
    for (const w of pv.warnings) log(`  💡 ${w}`);
  }

  // SQL verify
  const sqlResult = await verifySqlFromPages(nb, pages);
  log(`\n  ── SQL Verification: ${sqlResult.passed} passed, ${sqlResult.failed} failed ──`);
  for (const r of sqlResult.results) {
    if (!r.ok) log(`  ✗ ${r.label}: ${r.error}`);
  }

  // Auto-sync: re-export deployed group to keep local files in sync with live state.
  const deployedGroupTitle = routes.find(r => r.type === 'group')?.title;
  if (deployedGroupTitle) {
    await syncRoutesYaml(nb, root, deployedGroupTitle, log);
  }

  // Rebuild graph + _refs.yaml after sync
  try {
    const freshGraph = buildGraph(root);
    const gNodes = (freshGraph as any).nodes as Map<string, any>;
    let refsCount = 0;
    for (const [, n] of gNodes) {
      if (n.type !== 'page') continue;
      const refs = freshGraph.pageRefs(n.id || '');
      const pageDir = path.join(root, n.meta?.dir || `pages/${n.name}`);
      if (fs.existsSync(pageDir)) {
        saveYaml(path.join(pageDir, '_refs.yaml'), {
          _generated: true, _readonly: 'Auto-generated. Edits will be overwritten.',
          ...refs,
        });
        refsCount++;
      }
    }
    saveYaml(path.join(root, '_graph.yaml'), { stats: freshGraph.stats(), ...freshGraph.toJSON() });
    log(`  ✓ Graph: ${freshGraph.stats().nodes} nodes, ${refsCount} _refs.yaml`);
  } catch (e) {
    log(`  ! Graph rebuild: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
  }

  // ── Post-deploy: re-export + git diff ──
  const targetGroup = opts.group || routes.find(r => r.type === 'group')?.title || '';
  if (targetGroup) {
    try {
      // Save routes.yaml before re-export (re-export overwrites it with target group routes)
      const routesBackup = fs.readFileSync(routesFile, 'utf8');

      const { exportProject } = await import('../export');
      log('\n  ── Re-export for diff ──');
      await exportProject(nb, { outDir: root, group: targetGroup });

      // Restore original routes.yaml (source structure, not target)
      fs.writeFileSync(routesFile, routesBackup);

      const diff = gitDiff(root, log);
      if (diff) {
        log(`\n  ── Deploy diff (${diff.files} files changed) ──`);
        log(diff.summary);
      } else {
        log('  ✓ No diff — deploy matches export');
      }
    } catch (e) {
      log(`  ! Re-export failed: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
  }
}

// ── Block state extraction from live tree ──

const MODEL_MAP: Record<string, string> = {
  table: 'TableBlockModel', filterForm: 'FilterFormBlockModel',
  createForm: 'CreateFormModel', editForm: 'EditFormModel',
  details: 'DetailsBlockModel', list: 'ListBlockModel',
  gridCard: 'GridCardBlockModel', jsBlock: 'JSBlockModel',
  chart: 'ChartBlockModel', markdown: 'MarkdownBlockModel',
  iframe: 'IframeBlockModel',
};

function extractBlockState(
  liveTab: Record<string, unknown>,
  specBlocks: BlockSpec[],
): Record<string, BlockState> {
  const existing: Record<string, BlockState> = {};
  const tabSub = liveTab.subModels as Record<string, unknown> | undefined;
  const tabGrid = tabSub?.grid as Record<string, unknown> | undefined;
  const gridSub = tabGrid?.subModels as Record<string, unknown> | undefined;
  const items = gridSub?.items;
  const itemArr = (Array.isArray(items) ? items : []) as Record<string, unknown>[];
  const candidates = [...specBlocks];

  for (const item of itemArr) {
    const uid = item.uid as string || '';
    const use = item.use as string || '';
    if (!uid) continue;

    const matched = candidates.find(b =>
      use === MODEL_MAP[b.type] || use.toLowerCase().includes(b.type.toLowerCase()),
    );
    if (!matched) continue;

    const key = matched.key || matched.type;
    if (existing[key]) continue;

    const itemSub = item.subModels as Record<string, unknown> | undefined;
    // Block's own grid (for form/details/filterForm internal items), not the page grid
    const blockOwnGrid = itemSub?.grid as Record<string, unknown> | undefined;
    const blockGridUid = (blockOwnGrid?.uid as string) || '';
    const entry: BlockState = { uid, type: matched.type, grid_uid: blockGridUid };

    // Extract fields (table columns or form grid items)
    const columns = itemSub?.columns;
    const colArr = (Array.isArray(columns) ? columns : []) as Record<string, unknown>[];
    if (colArr.length) {
      entry.fields = {};
      for (const col of colArr) {
        const fp = ((col.stepParams as Record<string, unknown>)?.fieldSettings as Record<string, unknown>)
          ?.init as Record<string, unknown>;
        const fieldPath = (fp?.fieldPath || '') as string;
        if (fieldPath) entry.fields[fieldPath] = { wrapper: col.uid as string || '', field: '' };
      }
    }
    const blockGrid = itemSub?.grid as Record<string, unknown> | undefined;
    const bgItems = (blockGrid?.subModels as Record<string, unknown> | undefined)?.items;
    const bgArr = (Array.isArray(bgItems) ? bgItems : []) as Record<string, unknown>[];
    if (bgArr.length && !entry.fields) {
      entry.fields = {};
      for (const gi of bgArr) {
        const fp = ((gi.stepParams as Record<string, unknown>)?.fieldSettings as Record<string, unknown>)
          ?.init as Record<string, unknown>;
        const fieldPath = (fp?.fieldPath || '') as string;
        if (fieldPath) entry.fields[fieldPath] = { wrapper: gi.uid as string || '', field: '' };
      }
    }

    // Extract actions
    for (const actKey of ['actions', 'recordActions'] as const) {
      const acts = itemSub?.[actKey];
      const actArr = (Array.isArray(acts) ? acts : []) as Record<string, unknown>[];
      if (actArr.length) {
        const stateKey = actKey === 'recordActions' ? 'record_actions' : 'actions';
        if (!(entry as any)[stateKey]) (entry as any)[stateKey] = {};
        for (const a of actArr) {
          const aUid = a.uid as string || '';
          const aUse = a.use as string || '';
          const aType = aUse.replace('ActionModel', '').replace('Action', '');
          const aKey = aType.charAt(0).toLowerCase() + aType.slice(1);
          if (aUid) (entry as any)[stateKey][aKey] = { uid: aUid };
        }
      }
    }

    existing[key] = entry;
    const idx = candidates.indexOf(matched);
    if (idx >= 0) candidates.splice(idx, 1);
  }

  return existing;
}

// ── Git helpers ──

function gitSnapshot(dir: string, label: string, log: (msg: string) => void): void {
  try {
    // Init if needed
    if (!fs.existsSync(path.join(dir, '.git'))) {
      execSync('git init', { cwd: dir, stdio: 'pipe' });
      execSync('git add -A', { cwd: dir, stdio: 'pipe' });
      execSync(`git commit -m "init" --allow-empty`, { cwd: dir, stdio: 'pipe' });
    }
    // Commit current state
    execSync('git add -A', { cwd: dir, stdio: 'pipe' });
    const status = execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' }).trim();
    if (status) {
      execSync(`git commit -m "${label}" --allow-empty`, { cwd: dir, stdio: 'pipe' });
      log(`  git: ${label} snapshot committed`);
    }
  } catch { /* skip — git not required */ }
}

function gitDiff(dir: string, log: (msg: string) => void): { files: number; summary: string } | null {
  try {
    if (!fs.existsSync(path.join(dir, '.git'))) return null;
    execSync('git add -A', { cwd: dir, stdio: 'pipe' });
    const status = execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' }).trim();
    if (!status) return null;
    const lines = status.split('\n').filter(Boolean);
    const summary = lines.slice(0, 20).map(l => `    ${l}`).join('\n')
      + (lines.length > 20 ? `\n    ... and ${lines.length - 20} more` : '');
    // Commit post-deploy state
    execSync('git commit -m "post-deploy"', { cwd: dir, stdio: 'pipe' });
    // Show diff summary
    const diffStat = execSync('git diff HEAD~1 --stat', { cwd: dir, encoding: 'utf8' }).trim();
    return { files: lines.length, summary: diffStat || summary };
  } catch { return null; }
}

async function deployGroup(
  nb: NocoBaseClient,
  routeEntry: RouteEntry,
  pages: PageInfo[],
  state: ModuleState,
  root: string,
  force: boolean,
  log: (msg: string) => void,
  useBlueprint = false,
): Promise<void> {
  // Blueprint mode: let applyBlueprint create navigation + pages in one call
  if (useBlueprint) {
    // Ensure group exists for sub-page blueprint calls with groupId
    if (!state.group_id) {
      const result = await nb.createGroup(routeEntry.title, routeEntry.icon || 'appstoreoutlined');
      state.group_id = result.routeId;
      log(`  + group: ${routeEntry.title}`);
      nb.routes.clearCache();
    } else {
      log(`  = group: ${routeEntry.title}`);
    }

    for (const child of routeEntry.children || []) {
      if (child.type === 'flowPage') {
        const pageInfo = pages.find(p => p.title === child.title);
        if (pageInfo) {
          await deployPageBlueprint(nb, pageInfo, state, state.group_id!, routeEntry.title, log);
        }
      } else if (child.type === 'group') {
        const subGroupKey = `_subgroup_${slugify(child.title)}`;
        let subGroupId = (state as unknown as Record<string, unknown>)[subGroupKey] as number | undefined;
        if (!subGroupId) {
          const result = await nb.createGroup(child.title, child.icon || 'folderoutlined', state.group_id!);
          subGroupId = result.routeId;
          (state as unknown as Record<string, unknown>)[subGroupKey] = subGroupId;
          log(`  + sub-group: ${child.title}`);
        } else {
          log(`  = sub-group: ${child.title}`);
        }
        for (const sc of child.children || []) {
          const pageInfo = pages.find(p => p.title === sc.title);
          if (pageInfo) {
            await deployPageBlueprint(nb, pageInfo, state, subGroupId, child.title, log);
          }
        }
      }
    }
    return;
  }

  // Legacy mode: multi-step deploy
  if (!state.group_id) {
    const result = await nb.createGroup(routeEntry.title, routeEntry.icon || 'appstoreoutlined');
    state.group_id = result.routeId;
    log(`  + group: ${routeEntry.title}`);
    nb.routes.clearCache();
  } else {
    log(`  = group: ${routeEntry.title}`);
  }

  for (const child of routeEntry.children || []) {
    if (child.type === 'flowPage') {
      const pageInfo = pages.find(p => p.title === child.title);
      if (pageInfo) {
        await deployOnePage(nb, pageInfo, state, state.group_id!, force, log);
      }
    } else if (child.type === 'group') {
      const subGroupKey = `_subgroup_${slugify(child.title)}`;
      let subGroupId = (state as unknown as Record<string, unknown>)[subGroupKey] as number | undefined;
      if (!subGroupId) {
        const result = await nb.createGroup(child.title, child.icon || 'folderoutlined', state.group_id!);
        subGroupId = result.routeId;
        (state as unknown as Record<string, unknown>)[subGroupKey] = subGroupId;
        log(`  + sub-group: ${child.title}`);
      } else {
        log(`  = sub-group: ${child.title}`);
      }
      for (const sc of child.children || []) {
        const pageInfo = pages.find(p => p.title === sc.title);
        if (pageInfo) {
          await deployOnePage(nb, pageInfo, state, subGroupId, force, log);
        }
      }
    }
  }
}

async function deployOnePage(
  nb: NocoBaseClient,
  pageInfo: PageInfo,
  state: ModuleState,
  parentRouteId: number | null,
  force: boolean,
  log: (msg: string) => void,
): Promise<void> {
  const pageKey = slugify(pageInfo.title);
  let pageState = state.pages[pageKey];

  if (!pageState?.tab_uid) {
    const result = await nb.createPage(pageInfo.title, parentRouteId ?? undefined, pageInfo.icon);
    pageState = {
      route_id: result.routeId,
      page_uid: result.pageUid,
      tab_uid: result.tabSchemaUid,
      grid_uid: result.gridUid,
      blocks: {},
    };
    log(`  + page: ${pageInfo.title}`);
  } else {
    log(`  = page: ${pageInfo.title}`);
  }

  // Deploy surface — handle multi-tab pages
  const tabs = pageInfo.layout.tabs;
  if (tabs && tabs.length > 1) {
    // Multi-tab: deploy first tab to main tabSchemaUid
    const firstTabDir = path.join(pageInfo.dir, `tab_${slugify(tabs[0].title || 'tab0')}`);
    const firstTabSpec = { ...pageInfo.layout, blocks: tabs[0].blocks || [] };
    const firstBlocks = await deploySurface(
      nb, pageState.tab_uid, firstTabSpec, fs.existsSync(firstTabDir) ? firstTabDir : pageInfo.dir,
      force, pageState.blocks, log,
    );
    pageState.blocks = firstBlocks;

    // Create + deploy additional tabs — check existing first
    if (!pageState.tab_states) pageState.tab_states = {};

    await enablePageTabs(nb, pageState.route_id!, pageState.page_uid!, log);

    // Sync first tab: title, icon, hidden=true (default tab is hidden in enableTabs mode)
    const firstTabTitle = tabs[0].title || '';
    const firstTabIcon = (tabs[0] as unknown as Record<string, unknown>).icon as string || '';
    try {
      await nb.updateModel(pageState.tab_uid, {
        pageTabSettings: { title: { title: firstTabTitle } },
      });
      const allRoutes = await nb.http.get(`${nb.baseUrl}/api/desktopRoutes:list`, { params: { pageSize: 500 } });
      const tabRoute = (allRoutes.data.data || []).find(
        (r: any) => r.schemaUid === pageState.tab_uid && r.type === 'tabs',
      );
      if (tabRoute) {
        const routeUpdate: Record<string, unknown> = { title: firstTabTitle, hidden: true };
        if (firstTabIcon) routeUpdate.icon = firstTabIcon;
        await nb.http.post(`${nb.baseUrl}/api/desktopRoutes:update`,
          routeUpdate,
          { params: { 'filter[id]': tabRoute.id } },
        );
      }
    } catch (e) {
      log(`    ! tab rename: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
    }

    // Read existing tabs from live page
    let existingLiveTabs: { uid: string; title: string }[] = [];
    try {
      const pageData = await nb.get({ uid: pageState.page_uid! });
      const rawTabs = pageData.tree.subModels?.tabs;
      const tabArr = (Array.isArray(rawTabs) ? rawTabs : rawTabs ? [rawTabs] : []) as unknown as Record<string, unknown>[];
      existingLiveTabs = tabArr.map((t, i) => ({
        uid: t.uid as string || '',
        title: ((t.stepParams as Record<string, unknown>)?.pageTabSettings as Record<string, unknown>)
          ?.title as Record<string, unknown>
          ? (((t.stepParams as Record<string, unknown>)?.pageTabSettings as Record<string, unknown>)?.title as Record<string, unknown>)?.title as string || `Tab${i}`
          : (t.props as Record<string, unknown>)?.title as string || `Tab${i}`,
      }));
    } catch (e) {
      log(`    ! read live tabs: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
    }

    for (let ti = 1; ti < tabs.length; ti++) {
      const tabTitle = tabs[ti].title || `Tab${ti}`;
      const tabSlug = slugify(tabTitle);
      const tabDir = path.join(pageInfo.dir, `tab_${tabSlug}`);

      let tabState = (pageState.tab_states as Record<string, { tab_uid: string; blocks: Record<string, BlockState> }>)[tabSlug];
      if (!tabState?.tab_uid) {
        // Check if a live tab with matching title/slug exists
        const existingTab = existingLiveTabs.find((t, i) => i > 0 && (slugify(t.title) === tabSlug || t.title === tabTitle));
        if (existingTab) {
          tabState = { tab_uid: existingTab.uid, blocks: {} };
          log(`    = tab: ${tabTitle} (found existing)`);
        } else {
          try {
            const result = await nb.surfaces.addTab(pageState.page_uid!, tabTitle);
            const r = result as Record<string, unknown>;
            const tabUid = (r.tabSchemaUid || r.tabUid || r.uid || '') as string;
            tabState = { tab_uid: tabUid, blocks: {} };
            // Also update route title
            const tabRouteId = r.tabRouteId as number;
            if (tabRouteId) {
              try {
                const tabIcon = (tabs[ti] as unknown as Record<string, unknown>).icon as string || '';
                const routeUpdate: Record<string, unknown> = { title: tabTitle };
                if (tabIcon) routeUpdate.icon = tabIcon;
                await nb.http.post(`${nb.baseUrl}/api/desktopRoutes:update`,
                  routeUpdate,
                  { params: { 'filter[id]': tabRouteId } },
                );
              } catch (e) {
                log(`    ! tab route title: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
              }
            }
            log(`    + tab: ${tabTitle}`);
          } catch (e) {
            log(`    ! tab ${tabTitle}: ${e instanceof Error ? e.message : e}`);
            continue;
          }
        }
      } else {
        log(`    = tab: ${tabTitle}`);
      }

      const tabSpec = { blocks: tabs[ti].blocks, layout: tabs[ti].layout };
      const tabBlocks = await deploySurface(
        nb, tabState.tab_uid, tabSpec as any,
        fs.existsSync(tabDir) ? tabDir : pageInfo.dir,
        force, tabState.blocks, log,
      );
      tabState.blocks = tabBlocks;
      (pageState.tab_states as Record<string, unknown>)[tabSlug] = tabState;
    }
  } else {
    // Single tab
    const blocksState = await deploySurface(
      nb, pageState.tab_uid, pageInfo.layout, pageInfo.dir, force, pageState.blocks, log,
    );
    pageState.blocks = blocksState;
  }
  state.pages[pageKey] = pageState;

  // Deploy popups
  await deployPagePopups(nb, pageInfo, state, pageKey, log);
}

/**
 * Deploy a page using flowSurfaces:applyBlueprint — single API call for entire page.
 *
 * Creates navigation + page + all tabs + blocks + fields + actions + layout + assets.
 * Falls back to legacy deployOnePage if blueprint fails (e.g. unsupported block types).
 */
async function deployPageBlueprint(
  nb: NocoBaseClient,
  pageInfo: PageInfo,
  state: ModuleState,
  groupId: number,
  groupTitle: string,
  log: (msg: string) => void,
): Promise<void> {
  const pageKey = slugify(pageInfo.title);
  const pageState = state.pages[pageKey];

  // If page already exists in state, use replace mode
  const isReplace = !!pageState?.page_uid;

  const blueprint = pageToBlueprint(pageInfo, {
    groupId: isReplace ? undefined : groupId,
    groupTitle: isReplace ? undefined : groupTitle,
    mode: isReplace ? 'replace' : 'create',
    pageSchemaUid: isReplace ? pageState.page_uid : undefined,
  });

  try {
    const result = await nb.surfaces.applyBlueprint(blueprint as unknown as Record<string, unknown>) as Record<string, unknown>;
    const target = (result.target || {}) as Record<string, unknown>;
    const pageSchemaUid = (target.pageSchemaUid || '') as string;
    const pageUid = (target.pageUid || '') as string;

    log(`  ${isReplace ? '~' : '+'} page (blueprint): ${pageInfo.title}`);

    // Read back page structure + run deploySurface sync for each tab
    if (pageSchemaUid) {
      const pageData = await nb.get({ pageSchemaUid });
      const tree = pageData.tree;
      const liveTabs = tree.subModels?.tabs;
      const liveTabArr = Array.isArray(liveTabs) ? liveTabs : liveTabs ? [liveTabs] : [];

      const specTabs = pageInfo.layout.tabs;
      const isMultiTab = specTabs && specTabs.length > 1;

      const firstTabUid = liveTabArr.length
        ? (liveTabArr[0] as unknown as Record<string, unknown>).uid as string || ''
        : '';

      state.pages[pageKey] = {
        route_id: (target.routeId || 0) as number,
        page_uid: pageUid || pageSchemaUid,
        tab_uid: firstTabUid,
        blocks: {},
      };

      // Process each tab
      const tabCount = isMultiTab ? specTabs.length : 1;
      for (let ti = 0; ti < tabCount && ti < liveTabArr.length; ti++) {
        const liveTab = liveTabArr[ti] as unknown as Record<string, unknown>;
        const tabUid = liveTab.uid as string || '';
        const tabSpec = isMultiTab
          ? { blocks: specTabs[ti].blocks, layout: specTabs[ti].layout } as any
          : pageInfo.layout;
        const tabDir = isMultiTab
          ? (() => {
              const tslug = slugify(specTabs[ti].title || '');
              const td = path.join(pageInfo.dir, `tab_${tslug}`);
              return fs.existsSync(td) ? td : pageInfo.dir;
            })()
          : pageInfo.dir;

        // Extract existing block UIDs from live tab
        const existingBlocks = extractBlockState(liveTab, tabSpec.blocks || []);

        const blocksState = await deploySurface(
          nb, tabUid, tabSpec, tabDir, false, existingBlocks, log,
        );

        if (ti === 0) {
          state.pages[pageKey].blocks = blocksState;
        } else {
          if (!state.pages[pageKey].tab_states) state.pages[pageKey].tab_states = {};
          (state.pages[pageKey].tab_states as Record<string, unknown>)[slugify(specTabs![ti].title || '')] = {
            tab_uid: tabUid,
            blocks: blocksState,
          };
        }
      }
    }

    // Deploy popups (same two-pass logic as deployOnePage)
    await deployPagePopups(nb, pageInfo, state, pageKey, log);

  } catch (e) {
    const err = e as { response?: { data?: { errors?: { message: string }[] } }; message?: string };
    const apiMsg = err.response?.data?.errors?.[0]?.message || err.message || String(e);
    log(`  ! blueprint failed for ${pageInfo.title}: ${apiMsg.slice(0, 120)}`);
    log(`    falling back to legacy deploy...`);
    await deployOnePage(nb, pageInfo, state, groupId, false, log);
  }
}

/**
 * Deploy popups for a page — two-pass for nested ref resolution.
 * Extracted to share between deployOnePage and deployPageBlueprint.
 */
async function deployPagePopups(
  nb: NocoBaseClient,
  pageInfo: PageInfo,
  state: ModuleState,
  pageKey: string,
  log: (msg: string) => void,
): Promise<void> {
  if (!pageInfo.popups.length) return;
  const pageState = state.pages[pageKey];
  if (!pageState) return;
  if (!pageState.popups) pageState.popups = {};

  const expanded = expandPopups(pageInfo.popups);
  const deferred: typeof expanded = [];

  // Pass 1: page-level refs
  for (const ps of expanded) {
    const targetRef = ps.target.replace('$SELF', `$${pageKey}`);
    const resolver = new RefResolver(state);
    let targetUid: string;
    try {
      targetUid = resolver.resolveUid(targetRef);
    } catch {
      deferred.push(ps);
      continue;
    }
    const pp = targetRef.split('.').pop() || '';
    const popupKey = targetRef.replace(`$${pageKey}.`, '');
    const existingPopupBlocks = pageState.popups?.[popupKey]?.blocks || {};
    const popupBlocks = await deployPopup(nb, targetUid, targetRef, ps, pageInfo.dir, false, pp, log, existingPopupBlocks);
    if (Object.keys(popupBlocks).length) {
      pageState.popups[popupKey] = { target_uid: targetUid, blocks: popupBlocks };
      state.pages[pageKey] = pageState;
    }
  }

  // Enrich popup block state with live actions/fields (for Pass 2 ref resolution)
  for (const [popupKey, popupState] of Object.entries(pageState.popups || {})) {
    const pBlocks = (popupState as unknown as Record<string, unknown>).blocks as Record<string, BlockState> | undefined;
    if (!pBlocks) continue;
    for (const [bk, bv] of Object.entries(pBlocks)) {
      if (bv.actions && Object.keys(bv.actions).length) continue;
      // Read live block to get actions
      try {
        const blockData = await nb.get({ uid: bv.uid });
        const subModels = blockData.tree.subModels || {};
        for (const actKey of ['actions', 'recordActions'] as const) {
          const acts = (subModels as Record<string, unknown>)[actKey];
          const actArr = (Array.isArray(acts) ? acts : []) as Record<string, unknown>[];
          if (actArr.length) {
            const stateKey = actKey === 'recordActions' ? 'record_actions' : 'actions';
            if (!(bv as any)[stateKey]) (bv as any)[stateKey] = {};
            for (const a of actArr) {
              const aUid = a.uid as string || '';
              const aUse = a.use as string || '';
              const aType = aUse.replace('ActionModel', '').replace('Action', '');
              const aKey = aType.charAt(0).toLowerCase() + aType.slice(1);
              if (aUid) (bv as any)[stateKey][aKey] = { uid: aUid };
            }
          }
        }
        // Also extract fields
        const cols = (subModels as Record<string, unknown>).columns;
        const colArr = (Array.isArray(cols) ? cols : []) as Record<string, unknown>[];
        if (colArr.length && !bv.fields) {
          bv.fields = {};
          for (const col of colArr) {
            const fp = ((col.stepParams as Record<string, unknown>)?.fieldSettings as Record<string, unknown>)
              ?.init as Record<string, unknown>;
            const fieldPath = (fp?.fieldPath || '') as string;
            if (fieldPath) bv.fields[fieldPath] = { wrapper: col.uid as string || '', field: '' };
          }
        }
      } catch { /* skip */ }
    }
  }
  state.pages[pageKey] = pageState;

  // Pass 2: nested refs (targets inside popup blocks)
  if (deferred.length) {
    const resolver2 = new RefResolver(state);
    for (const ps of deferred) {
      const targetRef = ps.target.replace('$SELF', `$${pageKey}`);
      let targetUid: string;
      try {
        targetUid = resolver2.resolveUid(targetRef);
      } catch (e) {
        log(`  ! popup ${targetRef}: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      const pp = targetRef.split('.').pop() || '';
      const popupKey2 = targetRef.replace(`$${pageKey}.`, '');
      const existingPopupBlocks2 = pageState.popups?.[popupKey2]?.blocks || {};
      const popupBlocks = await deployPopup(nb, targetUid, targetRef, ps, pageInfo.dir, false, pp, log, existingPopupBlocks2);
      if (Object.keys(popupBlocks).length) {
        pageState.popups[popupKey2] = { target_uid: targetUid, blocks: popupBlocks };
      }
    }
  }
  state.pages[pageKey] = pageState;
}

/**
 * Re-export routes.yaml from live NocoBase state after deploy.
 *
 * For copy mode (Main -> CRM Copy), this syncs back from CRM Copy so spec
 * reflects the actual deployed state. Source template (Main) is unaffected.
 * Only routes.yaml is updated; use explicit `export-project` for full sync.
 */
async function syncRoutesYaml(
  nb: NocoBaseClient,
  root: string,
  groupTitle: string,
  log: (msg: string) => void,
): Promise<void> {
  try {
    nb.routes.clearCache();
    const liveRoutes = await nb.routes.list();
    const routeTree = liveRoutes
      .filter(r => {
        if (r.type === 'group' && r.title === groupTitle) return true;
        if (r.type === 'flowPage' && !r.parentId) return true; // top-level pages
        return false;
      })
      .filter(r => r.type !== 'tabs')
      .map(r => {
        const entry: Record<string, unknown> = { title: r.title, type: r.type };
        if (r.icon) entry.icon = r.icon;
        const children = (r.children || [])
          .filter(c => c.type !== 'tabs')
          .map(c => {
            const ce: Record<string, unknown> = { title: c.title, type: c.type };
            if (c.icon) ce.icon = c.icon;
            const sub = (c.children || []).filter(s => s.type !== 'tabs').map(s => ({ title: s.title, type: s.type }));
            if (sub.length) ce.children = sub;
            return ce;
          });
        if (children.length) entry.children = children;
        return entry;
      });
    fs.writeFileSync(path.join(root, 'routes.yaml'), dumpYaml(routeTree));
    log('\n  routes.yaml synced');
  } catch (e) {
    log(`\n  ! routes sync: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
  }
}

/**
 * Enable multi-tab mode on a page: update both the route and the RootPageModel.
 */
async function enablePageTabs(
  nb: NocoBaseClient,
  routeId: number,
  pageUid: string,
  log: (msg: string) => void,
): Promise<void> {
  try {
    // 1. Route
    await nb.http.post(`${nb.baseUrl}/api/desktopRoutes:update`,
      { enableTabs: true },
      { params: { 'filter[id]': routeId } },
    );
    // 2. RootPageModel — both props AND stepParams.pageSettings.general
    if (pageUid) {
      const fmResp = await nb.http.get(`${nb.baseUrl}/api/flowModels:get`, {
        params: { filterByTk: pageUid },
      });
      const fm = fmResp.data?.data || {};
      // props.enableTabs
      await nb.http.post(`${nb.baseUrl}/api/flowModels:save`, {
        uid: pageUid,
        props: { ...(fm.props || {}), enableTabs: true },
      });
      // stepParams.pageSettings.general.enableTabs
      const ps = fm.stepParams?.pageSettings?.general || {};
      if (!ps.enableTabs) {
        await nb.updateModel(pageUid, {
          pageSettings: { general: { ...ps, enableTabs: true } },
        });
      }
    }
  } catch (e) {
    log(`    ! enableTabs: ${e instanceof Error ? e.message.slice(0, 60) : e}`);
  }
}
