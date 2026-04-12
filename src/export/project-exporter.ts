/**
 * Project-level exporter — exports entire NocoBase app as a code project.
 *
 * Output structure:
 *   myapp/
 *     routes.yaml                  # Menu tree
 *     collections/                 # One file per collection
 *       nb_crm_leads.yaml
 *     pages/
 *       main/                      # Group directory
 *         overview/                # Page directory
 *           page.yaml              # Page metadata
 *           layout.yaml            # Blocks + layout (core)
 *           popups/
 *             addnew.yaml
 *             name.yaml
 *           js/
 *             kpi_total.js
 *           charts/
 *             by_status.yaml
 *             by_status.sql
 *           events/
 *             form_auto_fill.js
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { NocoBaseClient } from '../client';
import type { RouteInfo } from '../client/routes';
import type { FlowModelNode } from '../types/api';
import { exportBlock, TYPE_MAP, type PopupRef } from './block-exporter';
import { exportAllTemplates, exportTemplateUsages } from './template-exporter';
import { dumpYaml } from '../utils/yaml';
import { slugify } from '../utils/slugify';

interface ExportOptions {
  outDir: string;
  group?: string;       // only export pages under this group
  includeCollections?: boolean;
}

/**
 * Export entire app (or a group) as a project directory.
 */
export async function exportProject(
  nb: NocoBaseClient,
  opts: ExportOptions,
): Promise<void> {
  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  // Get routes (tree structure with children)
  const routes = await nb.routes.list();

  // Export routes.yaml
  const routesTree = buildRoutesTree(routes, opts.group);
  fs.writeFileSync(path.join(outDir, 'routes.yaml'), dumpYaml(routesTree));
  console.log(`  + routes.yaml`);

  // Export collections
  if (opts.includeCollections !== false) {
    await exportCollections(nb, outDir);
  }

  // Export V2 templates (popup + block)
  await exportAllTemplates(nb, outDir);
  await exportTemplateUsages(nb, outDir);

  // Export pages by traversing route tree
  const pagesDir = path.join(outDir, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });

  const exportedGroups = new Set<string>();
  for (const route of routes) {
    if (route.type === 'group') {
      if (opts.group && route.title !== opts.group) continue;
      // Skip duplicate groups (same title)
      if (exportedGroups.has(route.title || '')) continue;
      exportedGroups.add(route.title || '');
      const groupSlug = slugify(route.title || 'group');
      const groupDir = path.join(pagesDir, groupSlug);
      fs.mkdirSync(groupDir, { recursive: true });

      for (const child of route.children || []) {
        if (child.type === 'flowPage') {
          await exportPage(nb, child, groupDir);
        } else if (child.type === 'group') {
          const subDir = path.join(groupDir, slugify(child.title || 'sub'));
          fs.mkdirSync(subDir, { recursive: true });
          for (const sc of child.children || []) {
            if (sc.type === 'flowPage') {
              await exportPage(nb, sc, subDir);
            }
          }
        }
      }
    } else if (route.type === 'flowPage' && !opts.group) {
      await exportPage(nb, route, pagesDir);
    }
  }

  console.log(`\n  Exported to ${outDir}`);
}

/**
 * Export one page to its own directory.
 */
async function exportPage(
  nb: NocoBaseClient,
  route: RouteInfo,
  parentDir: string,
): Promise<void> {
  const pageTitle = route.title || 'untitled';
  const pageSlug = slugify(pageTitle);
  const pageDir = path.join(parentDir, pageSlug);
  // console.log(`  [exportPage] ${pageTitle} → ${pageDir}`);
  fs.mkdirSync(pageDir, { recursive: true });

  // Find tab schemaUid (child of flowPage with type=tabs)
  const children = route.children || [];
  const tabRoute = children.find(c => c.type === 'tabs');
  const tabUid = tabRoute?.schemaUid;

  if (!tabUid) {
    console.log(`  ! ${pageTitle}: no tab found, skipping`);
    return;
  }

  // page.yaml — metadata
  const pageMeta: Record<string, unknown> = {
    title: pageTitle,
    icon: route.icon || 'fileoutlined',
    route_id: route.id,
    schema_uid: route.schemaUid,
    tab_uid: tabUid,
  };
  fs.writeFileSync(path.join(pageDir, 'page.yaml'), dumpYaml(pageMeta));

  // Check if multi-tab page — read from RootPageModel (route.schemaUid)
  let tabs: { uid: string; title: string }[] = [];
  try {
    const pageData = await nb.get({ uid: route.schemaUid || '' });
    const rawTabs = pageData.tree.subModels?.tabs;
    const tabArr = (Array.isArray(rawTabs) ? rawTabs : rawTabs ? [rawTabs] : []) as FlowModelNode[];
    tabs = tabArr.map((t, i) => ({
      uid: t.uid,
      title: ((t.stepParams as Record<string, unknown>)?.pageTabSettings as Record<string, unknown>)
        ?.title as Record<string, unknown>
        ? (((t.stepParams as Record<string, unknown>)?.pageTabSettings as Record<string, unknown>)?.title as Record<string, unknown>)?.title as string || `Tab${i}`
        : (t as unknown as Record<string, unknown>).props
          ? ((t as unknown as Record<string, unknown>).props as Record<string, unknown>)?.title as string || `Tab${i}`
          : `Tab${i}`,
    }));
  } catch { /* single tab fallback */ }

  // If only 1 tab, export normally. If multi-tab, export each tab.
  if (tabs.length <= 1) {
    // Single tab — read from tabSchemaUid
    let tree: FlowModelNode;
    try {
      const data = await nb.get({ tabSchemaUid: tabUid });
      tree = data.tree;
    } catch {
      try {
        const data = await nb.get({ uid: tabUid });
        tree = data.tree;
      } catch {
        console.log(`  ! ${pageTitle}: failed to read content`);
        return;
      }
    }

    const grid = tree.subModels?.grid;
    if (!grid || Array.isArray(grid)) {
      console.log(`  ~ ${pageTitle} (empty)`);
      return;
    }

    await exportSingleTab(nb, grid as FlowModelNode, pageDir, pageSlug, pageMeta);
  } else {
    // Multi-tab — export each tab separately
    pageMeta.tabs = tabs.map(t => t.title);
    fs.writeFileSync(path.join(pageDir, 'page.yaml'), dumpYaml(pageMeta));

    for (let ti = 0; ti < tabs.length; ti++) {
      const tab = tabs[ti];
      const tabSlug = slugify(tab.title);
      const tabDir = path.join(pageDir, `tab_${tabSlug}`);
      fs.mkdirSync(tabDir, { recursive: true });

      try {
        const tabData = await nb.get({ uid: tab.uid });
        const tabGrid = tabData.tree.subModels?.grid;
        if (tabGrid && !Array.isArray(tabGrid)) {
          await exportSingleTab(nb, tabGrid as FlowModelNode, tabDir, `${pageSlug}_${tabSlug}`, { title: tab.title });
        }
      } catch {
        console.log(`    ! tab '${tab.title}': failed to read`);
      }
    }

    console.log(`  + ${pageTitle}: ${tabs.length} tabs`);
    return;
  }

}

/**
 * Export a single tab's grid into a directory (layout.yaml + js/ + charts/ + popups/).
 */
async function exportSingleTab(
  nb: NocoBaseClient,
  gridNode: FlowModelNode,
  outDir: string,
  prefix: string,
  meta: Record<string, unknown>,
): Promise<void> {
  const jsDir = path.join(outDir, 'js');
  const popupsDir = path.join(outDir, 'popups');
  const eventsDir = path.join(outDir, 'events');

  const rawItems = gridNode.subModels?.items;
  const items = (Array.isArray(rawItems) ? rawItems : []) as FlowModelNode[];
  const usedKeys = new Set<string>();

  const blocks: Record<string, unknown>[] = [];
  const blockUidToKey = new Map<string, string>();
  const allPopupRefs: PopupRef[] = [];

  for (let i = 0; i < items.length; i++) {
    const exported = exportBlock(items[i], jsDir, prefix, i, usedKeys);
    if (!exported) continue;

    const spec = { ...exported.spec };
    delete spec._popups;

    // Move event flow files from js/ to events/
    const eventFlows = spec.event_flows as Record<string, unknown>[];
    if (eventFlows?.length) {
      fs.mkdirSync(eventsDir, { recursive: true });
      for (const ef of eventFlows) {
        if (ef.file && typeof ef.file === 'string') {
          const fname = (ef.file as string).replace('./js/', '');
          ef.file = `./events/${fname}`;
        }
      }
      moveEventFiles(jsDir, eventsDir);
    }

    blocks.push(spec);
    blockUidToKey.set(items[i].uid, exported.key);
    allPopupRefs.push(...exported.popupRefs);
  }

  // Dereference reference blocks → convert to actual form/table content
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi] as Record<string, unknown>;
    if (b.type !== 'reference' || !b._reference) continue;
    const ref = b._reference as Record<string, unknown>;
    const targetUid = ref.targetUid as string;
    if (!targetUid) continue;

    try {
      const targetData = await nb.get({ uid: targetUid });
      const targetTree = targetData.tree;
      const targetType = TYPE_MAP[targetTree.use || ''] || 'createForm';
      const targetColl = ((targetTree.stepParams as Record<string, unknown>)
        ?.resourceSettings as Record<string, unknown>)
        ?.init as Record<string, unknown>;

      // Export target form as a regular block
      const usedKeysRef = new Set<string>();
      const exported = exportBlock(targetTree as any, jsDir, prefix, bi, usedKeysRef);
      if (exported) {
        const resolvedSpec = { ...exported.spec } as Record<string, unknown>;
        resolvedSpec.key = targetType; // use actual type as key (table, createForm, etc.)
        resolvedSpec.type = targetType;
        if (targetColl?.collectionName) resolvedSpec.coll = targetColl.collectionName;
        delete resolvedSpec._popups;
        delete resolvedSpec._reference;
        // Save reference info as comment
        resolvedSpec._dereferenced_from = ref.templateName;
        blocks[bi] = resolvedSpec;
        allPopupRefs.push(...exported.popupRefs);
      }
    } catch {
      // Can't dereference — keep as reference block
    }
    delete b._reference;
  }

  // Infer coll for filterForm from sibling table/reference/form blocks
  const pageColl = blocks.find(b => {
    const br = b as Record<string, unknown>;
    return (br.type === 'table' || br.type === 'createForm') && br.coll;
  })
    ?.coll as string || '';
  for (const b of blocks) {
    const br = b as Record<string, unknown>;
    if (br.type === 'filterForm' && !br.coll && pageColl) {
      br.coll = pageColl;
    }
  }

  // Layout
  const layout = exportLayout(gridNode, blockUidToKey);
  const layoutSpec: Record<string, unknown> = { blocks };
  if (layout.length) layoutSpec.layout = layout;
  fs.writeFileSync(path.join(outDir, 'layout.yaml'), dumpYaml(layoutSpec));

  // Popups
  if (allPopupRefs.length) {
    fs.mkdirSync(popupsDir, { recursive: true });
    await exportPopupsToDir(nb, allPopupRefs, popupsDir, jsDir, prefix);
  }

  // Clean empty dirs
  for (const d of [jsDir, path.join(outDir, 'charts'), popupsDir, eventsDir]) {
    try {
      if (fs.existsSync(d) && !fs.readdirSync(d).length) fs.rmdirSync(d);
    } catch { /* skip */ }
  }

  console.log(`  + ${meta.title || prefix}: ${blocks.length} blocks, ${allPopupRefs.length} popups`);
}

/**
 * Export popups to individual files in popups/ directory.
 */
async function exportPopupsToDir(
  nb: NocoBaseClient,
  refs: PopupRef[],
  popupsDir: string,
  jsDir: string,
  prefix: string,
  exportedUids = new Set<string>(),
  depth = 0,
): Promise<void> {
  if (depth > 8) return;

  for (const ref of refs) {
    if (exportedUids.has(ref.field_uid)) continue;
    exportedUids.add(ref.field_uid);

    try {
      const data = await nb.get({ uid: ref.field_uid });
      const tree = data.tree;
      const popupPage = tree.subModels?.page;
      if (!popupPage || Array.isArray(popupPage)) continue;

      const popupNode = popupPage as FlowModelNode;
      const mode = ((tree.stepParams as Record<string, unknown>)?.popupSettings as Record<string, unknown>)
        ?.openView as Record<string, unknown>;

      const rawTabs = popupNode.subModels?.tabs;
      const tabs = Array.isArray(rawTabs) ? rawTabs : rawTabs ? [rawTabs] : [];

      const popupSpec: Record<string, unknown> = {
        target: ref.target || ref.field,
        mode: (mode?.mode as string) || 'drawer',
      };

      const nestedPopupRefs: PopupRef[] = [];

      if (tabs.length <= 1) {
        // Single tab
        const tabGrid = tabs.length ? (tabs[0] as FlowModelNode).subModels?.grid : null;
        if (tabGrid && !Array.isArray(tabGrid)) {
          const { blocks, popupRefs: nested } = await exportGridBlocks(nb, tabGrid as FlowModelNode, jsDir, `${prefix}_${ref.field}`);
          popupSpec.blocks = blocks;
          nestedPopupRefs.push(...nested);
        }
      } else {
        // Multi-tab
        const tabSpecs: Record<string, unknown>[] = [];
        for (let i = 0; i < tabs.length; i++) {
          const tab = tabs[i] as FlowModelNode;
          const title = ((tab.stepParams as Record<string, unknown>)?.pageTabSettings as Record<string, unknown>)
            ?.title as Record<string, unknown>;
          const tabGrid = tab.subModels?.grid;
          if (tabGrid && !Array.isArray(tabGrid)) {
            const { blocks, popupRefs: nested } = await exportGridBlocks(nb, tabGrid as FlowModelNode, jsDir, `${prefix}_${ref.field}_tab${i}`);
            tabSpecs.push({ title: (title?.title as string) || `Tab${i}`, blocks });
            nestedPopupRefs.push(...nested);
          }
        }
        popupSpec.tabs = tabSpecs;
      }

      // Write popup file
      const fname = ref.block_key
        ? `${ref.block_key}.${ref.field}.yaml`
        : `${ref.field}.yaml`;
      fs.writeFileSync(path.join(popupsDir, fname), dumpYaml(popupSpec));

      // Recurse into nested popups
      if (nestedPopupRefs.length) {
        await exportPopupsToDir(nb, nestedPopupRefs, popupsDir, jsDir, `${prefix}_${ref.field}`, exportedUids, depth + 1);
      }
    } catch {
      // popup read failed
    }
  }
}

async function exportGridBlocks(
  nb: NocoBaseClient,
  grid: FlowModelNode,
  jsDir: string,
  prefix: string,
): Promise<{ blocks: Record<string, unknown>[]; popupRefs: PopupRef[] }> {
  const rawItems = grid.subModels?.items;
  const items = (Array.isArray(rawItems) ? rawItems : []) as FlowModelNode[];
  const usedKeys = new Set<string>();
  const blocks: Record<string, unknown>[] = [];
  const popupRefs: PopupRef[] = [];

  for (let i = 0; i < items.length; i++) {
    const exported = exportBlock(items[i], jsDir, prefix, i, usedKeys);
    if (!exported) continue;
    const spec = { ...exported.spec };
    delete spec._popups;
    blocks.push(spec);
    popupRefs.push(...exported.popupRefs);
  }

  // Dereference reference blocks
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi] as Record<string, unknown>;
    if (b.type !== 'reference' || !b._reference) continue;
    const ref = b._reference as Record<string, unknown>;
    const targetUid = ref.targetUid as string;
    if (!targetUid) continue;
    try {
      const targetData = await nb.get({ uid: targetUid });
      const targetType = TYPE_MAP[targetData.tree.use || ''] || 'createForm';
      const targetColl = ((targetData.tree.stepParams as Record<string, unknown>)
        ?.resourceSettings as Record<string, unknown>)?.init as Record<string, unknown>;
      const usedKeysRef = new Set<string>();
      const resolved = exportBlock(targetData.tree as any, jsDir, prefix, bi, usedKeysRef);
      if (resolved) {
        const rspec = { ...resolved.spec } as Record<string, unknown>;
        rspec.key = targetType;  // use actual type as key (table, createForm, etc.)
        rspec.type = targetType;
        if (targetColl?.collectionName) rspec.coll = targetColl.collectionName;
        delete rspec._popups;
        delete rspec._reference;
        rspec._dereferenced_from = ref.templateName;
        blocks[bi] = rspec;
        popupRefs.push(...resolved.popupRefs);
      }
    } catch { /* keep as reference */ }
    delete b._reference;
  }

  return { blocks, popupRefs };
}

function exportLayout(
  grid: FlowModelNode,
  blockUidToKey: Map<string, string>,
): unknown[] {
  const gridSettings = (grid.stepParams as Record<string, unknown>)?.gridSettings as Record<string, unknown>;
  const gridInner = (gridSettings?.grid || {}) as Record<string, unknown>;
  const rows = (gridInner.rows || {}) as Record<string, string[][]>;
  const sizes = (gridInner.sizes || {}) as Record<string, number[]>;

  const layout: unknown[] = [];

  for (const [rk, cols] of Object.entries(rows)) {
    const rowSizes = sizes[rk] || [];

    if (cols.length === 1) {
      // Single column — blocks are stacked vertically → one row per block
      // Single column — blocks are stacked vertically
      for (const uid of cols[0]) {
        const key = blockUidToKey.get(uid);
        if (key) layout.push([key]);
      }
    } else {
      // Multiple columns — blocks side by side in one row
      const row: unknown[] = [];
      for (let i = 0; i < cols.length; i++) {
        // Each column may have multiple stacked blocks
        for (const uid of cols[i]) {
          const key = blockUidToKey.get(uid);
          if (!key) continue;
          const size = rowSizes[i];
          if (size && size !== Math.floor(24 / cols.length)) {
            row.push({ [key]: size });
          } else {
            row.push(key);
          }
        }
      }
      if (row.length) layout.push(row);
    }
  }

  return layout;
}

function buildRoutesTree(
  routes: RouteInfo[],
  filterGroup?: string,
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  const seenTitles = new Set<string>();
  for (const r of routes) {
    if (r.type === 'tabs') continue;
    if (filterGroup && r.type === 'group' && r.title !== filterGroup) continue;
    // Skip duplicate groups (same title)
    if (r.type === 'group' && seenTitles.has(r.title || '')) continue;
    if (r.type === 'group') seenTitles.add(r.title || '');

    const entry: Record<string, unknown> = {
      title: r.title || r.schemaUid,
      type: r.type,
    };
    if (r.icon) entry.icon = r.icon;

    const childEntries = (r.children || [])
      .filter(c => c.type !== 'tabs')
      .map(c => {
        const ce: Record<string, unknown> = { title: c.title, type: c.type };
        if (c.icon) ce.icon = c.icon;
        const subEntries = (c.children || [])
          .filter(s => s.type !== 'tabs')
          .map(s => ({ title: s.title, type: s.type }));
        if (subEntries.length) ce.children = subEntries;
        return ce;
      });
    if (childEntries.length) entry.children = childEntries;
    result.push(entry);
  }
  return result;
}

async function exportCollections(nb: NocoBaseClient, outDir: string): Promise<void> {
  const collDir = path.join(outDir, 'collections');
  fs.mkdirSync(collDir, { recursive: true });

  const resp = await nb.http.get(`${nb.baseUrl}/api/collections:list`, { params: { paginate: 'false' } });
  const colls = (resp.data.data || []) as Record<string, unknown>[];

  let count = 0;
  for (const c of colls) {
    const name = c.name as string;
    if (!name || name.startsWith('_') || !name.startsWith('nb_')) continue;

    const meta = await nb.collections.fieldMeta(name);
    const fields = Object.entries(meta).map(([fname, fmeta]) => ({
      name: fname,
      interface: fmeta.interface,
    }));

    fs.writeFileSync(path.join(collDir, `${name}.yaml`), dumpYaml({
      name,
      title: c.title || name,
      fields,
    }));
    count++;
  }
  console.log(`  + ${count} collections`);
}

function moveEventFiles(jsDir: string, eventsDir: string): void {
  try {
    const files = fs.readdirSync(jsDir);
    for (const f of files) {
      if (f.includes('_event_')) {
        fs.renameSync(path.join(jsDir, f), path.join(eventsDir, f));
      }
    }
  } catch { /* skip */ }
}
