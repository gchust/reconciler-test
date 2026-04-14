/**
 * Deploy V2 templates from templates/ directory.
 *
 * For each template in _index.yaml:
 *   - If template already exists in NocoBase (by name + collection match) → reuse UID
 *   - If template is new → create via flowSurfaces:saveTemplate flow:
 *     a. Create a temporary hidden page
 *     b. Compose the template content block on that page
 *     c. Call saveTemplate with saveMode: 'duplicate'
 *     d. Delete the temporary page
 *     e. Record the new templateUid
 *
 * Returns uid mapping (old → new) for downstream page deployers.
 *
 * ⚠️ PITFALLS:
 * - Match templates by name + collectionName (not UID — UIDs differ between instances)
 * - Popup templates: host is a field-like node with ChildPage, not a page grid
 * - Block templates: compose on a temp page grid, then saveTemplate on the block UID
 * - Template deployer is idempotent (safe to run multiple times)
 * - Never modify existing template content — only create new ones
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { NocoBaseClient } from '../client';
import { loadYaml } from '../utils/yaml';
import { generateUid } from '../utils/uid';
import { toComposeBlock } from './block-composer';

interface TemplateIndex {
  uid: string;
  name: string;
  type: 'popup' | 'block';
  collection?: string;
  targetUid: string;
  file: string;
}

interface ExistingTemplate {
  uid: string;
  name: string;
  collectionName?: string;
  targetUid: string;
}

export type TemplateUidMap = Map<string, string>; // oldUid → newUid

/**
 * Auto-discover template YAML files when _index.yaml doesn't exist.
 * Scans templates/popup/ and templates/block/ directories.
 */
function discoverTemplates(tplDir: string): TemplateIndex[] {
  const result: TemplateIndex[] = [];
  for (const subDir of ['popup', 'block']) {
    const dir = path.join(tplDir, subDir);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.yaml')).sort()) {
      try {
        const content = loadYaml<Record<string, unknown>>(path.join(dir, f));
        if (!content?.name) continue;
        result.push({
          uid: (content.uid as string) || generateUid(),
          name: content.name as string,
          type: (content.type as 'popup' | 'block') || (subDir === 'popup' ? 'popup' : 'block'),
          collection: (content.collectionName as string) || undefined,
          targetUid: (content.targetUid as string) || generateUid(),
          file: `${subDir}/${f}`,
        });
      } catch { /* skip malformed */ }
    }
  }
  return result;
}

/**
 * Deploy all templates. Returns uid mapping (old → new).
 *
 * Called before page deployment so that popupTemplateUid references
 * can be resolved in page specs.
 */
export async function deployTemplates(
  nb: NocoBaseClient,
  projectDir: string,
  log: (msg: string) => void = console.log,
): Promise<TemplateUidMap> {
  const tplDir = path.join(projectDir, 'templates');
  if (!fs.existsSync(tplDir)) return new Map();

  // Build index: prefer _index.yaml, then auto-discover YAML files
  let index: TemplateIndex[];
  const indexFile = path.join(tplDir, '_index.yaml');
  if (fs.existsSync(indexFile)) {
    index = loadYaml<TemplateIndex[]>(indexFile) || [];
  } else {
    index = discoverTemplates(tplDir);
  }
  if (!index.length) return new Map();

  log('\n  -- Templates --');

  // Fetch existing templates to avoid duplicates
  const existingResp = await nb.http.get(`${nb.baseUrl}/api/flowModelTemplates:list`, {
    params: { paginate: false },
  });
  const existing = (existingResp.data?.data || []) as ExistingTemplate[];

  // Build lookup: "name|collection" → existing entry
  const existingByKey = new Map<string, ExistingTemplate>();
  for (const t of existing) {
    const key = makeMatchKey(t.name, t.collectionName || '');
    existingByKey.set(key, t);
  }
  // Also keep name-only fallback for templates without collection
  const existingByName = new Map<string, ExistingTemplate>();
  for (const t of existing) {
    if (!existingByName.has(t.name)) {
      existingByName.set(t.name, t);
    }
  }

  const uidMap: TemplateUidMap = new Map();
  let created = 0;
  let reused = 0;
  let skipped = 0;

  for (const tpl of index) {
    // Read template spec for content + collection info
    const tplFile = path.join(tplDir, tpl.file);
    if (!fs.existsSync(tplFile)) {
      log(`  ! template ${tpl.name}: file not found (${tpl.file})`);
      skipped++;
      continue;
    }
    const tplSpec = loadYaml<Record<string, unknown>>(tplFile);
    const collName = (tpl.collection || tplSpec.collectionName) as string || '';

    // Check if template already exists (by name + collection)
    const matchKey = makeMatchKey(tpl.name, collName);
    const existingEntry = existingByKey.get(matchKey) || existingByName.get(tpl.name);
    if (existingEntry) {
      uidMap.set(tpl.uid, existingEntry.uid);
      if (tpl.targetUid && existingEntry.targetUid) {
        uidMap.set(tpl.targetUid, existingEntry.targetUid);
      }
      reused++;
      continue;
    }

    // Template is new — create it
    const content = tplSpec.content as Record<string, unknown>;
    if (!content) {
      log(`  ! template ${tpl.name}: no content in spec`);
      skipped++;
      continue;
    }

    try {
      let result: { templateUid: string; targetUid: string } | undefined;

      if (tpl.type === 'block') {
        result = await createBlockTemplate(nb, tpl.name, content, collName, tplSpec, tplDir, log);
      } else if (tpl.type === 'popup') {
        result = await createPopupTemplate(nb, tpl.name, content, collName, tplSpec, tplDir, log);
      }

      if (!result) {
        log(`  ! template ${tpl.name}: failed to create`);
        skipped++;
        continue;
      }

      uidMap.set(tpl.uid, result.templateUid);
      if (tpl.targetUid) {
        uidMap.set(tpl.targetUid, result.targetUid);
      }
      log(`  + template "${tpl.name}" (${tpl.type}) → ${result.templateUid}`);
      created++;
    } catch (e) {
      log(`  ! template ${tpl.name}: ${e instanceof Error ? e.message.slice(0, 100) : e}`);
      skipped++;
    }
  }

  log(`  templates: ${created} created, ${reused} reused${skipped ? `, ${skipped} skipped` : ''}`);
  return uidMap;
}

// ── Block template creation ──

/**
 * Create a block template via saveTemplate flow:
 *   1. Create temporary hidden page
 *   2. Compose the block content on that page
 *   3. Call flowSurfaces:saveTemplate to snapshot the block as a template
 *   4. Delete the temporary page
 */
async function createBlockTemplate(
  nb: NocoBaseClient,
  name: string,
  content: Record<string, unknown>,
  collName: string,
  tplSpec: Record<string, unknown>,
  tplDir: string,
  log: (msg: string) => void,
): Promise<{ templateUid: string; targetUid: string } | undefined> {
  const composeBlock = toComposeBlock(content as any, collName);
  if (!composeBlock) {
    // Fallback: block type not supported by compose — use direct model creation
    return createBlockTemplateViaModel(nb, name, content, collName, tplSpec);
  }

  // 1. Create temporary page
  const tempPage = await createTempPage(nb);
  if (!tempPage) return undefined;

  try {
    // 2. Compose the block
    const result = await nb.surfaces.compose(tempPage.tabUid, [composeBlock], 'replace');
    const blockUid = result.blocks?.[0]?.uid;
    if (!blockUid) {
      log(`    . compose returned no block UID for "${name}"`);
      return undefined;
    }

    // 3. Save as template via flowSurfaces:saveTemplate
    const saveResult = await nb.surfaces.saveTemplate({
      target: { uid: blockUid },
      name,
      type: 'block',
      collectionName: collName,
      dataSourceKey: (tplSpec.dataSourceKey as string) || 'main',
      saveMode: 'duplicate',
    }) as Record<string, unknown>;

    const templateUid = (saveResult.uid || saveResult.templateUid) as string;
    const targetUid = (saveResult.targetUid) as string || blockUid;

    if (!templateUid) {
      // Fallback: saveTemplate didn't return expected format — register manually
      return registerTemplateManually(nb, name, 'block', collName, tplSpec, blockUid);
    }

    return { templateUid, targetUid };
  } finally {
    // 4. Clean up temporary page
    await deleteTempPage(nb, tempPage);
  }
}

// ── Popup template creation ──

/**
 * Create a popup template:
 *   1. Create a field-like host node (DisplayTextFieldModel)
 *   2. Compose blocks into its ChildPage (auto-created by compose)
 *   3. Register as popup template via flowModelTemplates:create
 *
 * Popup templates use a different structure than block templates:
 * the targetUid points to the field host node, which contains a ChildPage
 * with tabs/blocks inside.
 */
async function createPopupTemplate(
  nb: NocoBaseClient,
  name: string,
  content: Record<string, unknown>,
  collName: string,
  tplSpec: Record<string, unknown>,
  tplDir: string,
  log: (msg: string) => void,
): Promise<{ templateUid: string; targetUid: string } | undefined> {
  // Strategy: create temp page → add table with clickToOpen field →
  // deploy popup content → saveTemplate on the field → cleanup
  let tempGroupId: number | null = null;
  let tempRouteId: number | null = null;

  try {
    // 1. Create temp hidden menu group + page via blueprint
    const groupResp = await nb.http.post(`${nb.baseUrl}/api/desktopRoutes:create`, {
      type: 'group', title: '__tpl_temp__', hidden: true,
    });
    tempGroupId = groupResp.data?.data?.id;

    const bpResult = await nb.surfaces.applyBlueprint({
      version: '1', mode: 'create',
      navigation: { group: { routeId: tempGroupId }, item: { title: '__popup_tpl__' } },
      page: { title: '__popup_tpl__' },
      tabs: [{ key: 'main', title: 'Main', blocks: [
        { key: 'details', type: 'details', collection: collName },
      ] }],
    } as unknown as Record<string, unknown>) as Record<string, unknown>;

    const pageSchemaUid = (bpResult.target as Record<string, unknown>)?.pageSchemaUid as string || '';
    tempRouteId = (bpResult.target as Record<string, unknown>)?.routeId as number || null;
    if (!pageSchemaUid) throw new Error('failed to create temp page');

    // 2. Read page → find details block → add field with clickToOpen
    const pageData = await nb.get({ pageSchemaUid });
    const tabArr = Array.isArray(pageData.tree.subModels?.tabs) ? pageData.tree.subModels.tabs : [pageData.tree.subModels?.tabs];
    const gridItems = tabArr[0]?.subModels?.grid?.subModels?.items;
    const blockUid = (Array.isArray(gridItems) && gridItems.length) ? gridItems[0].uid : '';
    if (!blockUid) throw new Error('no block in temp page');

    // 3. Add a field with clickToOpen to host the popup
    const fieldResult = await nb.surfaces.addField(blockUid, 'id') as Record<string, unknown>;
    const fieldWrapperUid = fieldResult.wrapperUid || fieldResult.uid;
    if (!fieldWrapperUid) throw new Error('addField failed');

    // Get field model UID
    const blockData = await nb.get({ uid: fieldWrapperUid as string });
    const fieldModel = blockData.tree.subModels?.field;
    const fieldUid = (fieldModel && !Array.isArray(fieldModel)) ? (fieldModel as Record<string, unknown>).uid as string : '';
    if (!fieldUid) throw new Error('no field UID');

    // 4. Set popupSettings + compose popup content
    await nb.http.post(`${nb.baseUrl}/api/flowModels:save`, {
      uid: fieldUid,
      stepParams: {
        popupSettings: { openView: { collectionName: collName, dataSourceKey: 'main', mode: 'drawer', size: 'large', pageModelClass: 'ChildPageModel', uid: fieldUid } },
        displayFieldSettings: { clickToOpen: { clickToOpen: true } },
      },
    });

    // Read back to get ChildPage tab UID
    const fieldData = await nb.get({ uid: fieldUid });
    let popupTabUid = '';
    const fieldPage = (fieldData.tree.subModels as Record<string, unknown>)?.page as Record<string, unknown>;
    if (fieldPage) {
      const popupTabs = fieldPage.subModels as Record<string, unknown>;
      const tabList = popupTabs?.tabs;
      const tabArr = Array.isArray(tabList) ? tabList : tabList ? [tabList] : [];
      if (tabArr.length) popupTabUid = (tabArr[0] as Record<string, unknown>).uid as string || '';
    }

    // Compose popup content
    const tabs = content.tabs as Record<string, unknown>[] | undefined;
    const blocks = content.blocks as Record<string, unknown>[] | undefined;
    const firstBlocks = tabs?.length ? (tabs[0].blocks || []) as Record<string, unknown>[] : blocks || [];

    if (popupTabUid && firstBlocks.length) {
      const composeBlocks = firstBlocks.map(b => toComposeBlock(b as any, collName)).filter(Boolean) as Record<string, unknown>[];
      if (composeBlocks.length) {
        await nb.surfaces.compose(popupTabUid, composeBlocks, 'replace');
      }
    }

    // 5. saveTemplate on the field
    const saveResult = await nb.surfaces.saveTemplate({
      target: { uid: fieldUid },
      name,
      description: '',
      saveMode: 'duplicate',
    }) as Record<string, unknown>;

    const templateUid = (saveResult.uid || saveResult.templateUid) as string;
    const targetUid = (saveResult.targetUid) as string || fieldUid;

    if (templateUid) {
      log(`    + popup template: ${name} (${templateUid})`);
      return { templateUid, targetUid };
    }
  } catch (e) {
    log(`    . popup template ${name}: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
  } finally {
    // Cleanup temp page + group (children first)
    try {
      if (tempGroupId) {
        const routes = await nb.http.get(`${nb.baseUrl}/api/desktopRoutes:list`, { params: { paginate: 'false', tree: 'true' } });
        const grp = (routes.data.data || []).find((r: any) => r.id === tempGroupId);
        if (grp?.children) for (const c of grp.children) {
          if (c.children) for (const sc of c.children) await nb.http.post(`${nb.baseUrl}/api/desktopRoutes:destroy`, {}, { params: { filterByTk: sc.id } }).catch(() => {});
          await nb.http.post(`${nb.baseUrl}/api/desktopRoutes:destroy`, {}, { params: { filterByTk: c.id } }).catch(() => {});
        }
        await nb.http.post(`${nb.baseUrl}/api/desktopRoutes:destroy`, {}, { params: { filterByTk: tempGroupId } }).catch(() => {});
      }
    } catch { /* best effort cleanup */ }
  }

  // Fallback: register manually
  return registerTemplateManually(nb, name, 'popup', collName, tplSpec, generateUid());
}

// ── Fallback: direct model creation for unsupported block types ──

async function createBlockTemplateViaModel(
  nb: NocoBaseClient,
  name: string,
  content: Record<string, unknown>,
  collName: string,
  tplSpec: Record<string, unknown>,
): Promise<{ templateUid: string; targetUid: string } | undefined> {
  const hostUid = generateUid();

  const composeBlock = toComposeBlock(content as any, collName);
  if (!composeBlock) return undefined;

  // Create a temporary grid to compose into
  await nb.models.save({
    uid: hostUid,
    use: 'BlockGridModel',
    stepParams: {},
    flowRegistry: {},
  });

  const result = await nb.surfaces.compose(hostUid, [composeBlock], 'replace');
  const blockUid = result.blocks?.[0]?.uid || hostUid;

  return registerTemplateManually(nb, name, 'block', collName, tplSpec, blockUid);
}

// ── Manual template registration ──

async function registerTemplateManually(
  nb: NocoBaseClient,
  name: string,
  type: 'popup' | 'block',
  collName: string,
  tplSpec: Record<string, unknown>,
  targetUid: string,
): Promise<{ templateUid: string; targetUid: string } | undefined> {
  const newUid = generateUid();
  const resp = await nb.http.post(`${nb.baseUrl}/api/flowModelTemplates:create`, {
    values: {
      uid: newUid,
      name,
      type,
      collectionName: collName,
      dataSourceKey: (tplSpec.dataSourceKey as string) || 'main',
      targetUid,
    },
  });

  const createdUid = resp.data?.data?.uid as string;
  if (createdUid) {
    return { templateUid: createdUid, targetUid };
  }
  return undefined;
}

// ── Temp page lifecycle ──

interface TempPage {
  routeId: number;
  pageUid: string;
  tabUid: string;
  gridUid: string;
}

/**
 * Create a temporary hidden page for composing template content.
 * Returns page info needed for compose and cleanup.
 */
async function createTempPage(
  nb: NocoBaseClient,
): Promise<TempPage | undefined> {
  try {
    // Create a hidden menu item
    const menu = await nb.surfaces.createMenu({
      title: `_tpl_temp_${generateUid(6)}`,
      type: 'item',
      icon: 'fileoutlined',
    });

    // Create the page surface
    const page = await nb.surfaces.createPage(menu.routeId);

    return {
      routeId: menu.routeId,
      pageUid: page.pageUid,
      tabUid: page.tabSchemaUid,
      gridUid: page.gridUid,
    };
  } catch {
    return undefined;
  }
}

/**
 * Delete a temporary page and its route.
 */
async function deleteTempPage(
  nb: NocoBaseClient,
  tempPage: TempPage,
): Promise<void> {
  try {
    // Delete the route (cascades to page content)
    await nb.http.post(`${nb.baseUrl}/api/desktopRoutes:destroy`, {
      filterByTk: tempPage.routeId,
    });
  } catch {
    // Best-effort cleanup — don't fail the template deploy
    try {
      await nb.surfaces.destroyPage(tempPage.pageUid);
    } catch { /* ignore */ }
  }
}

// ── Matching helpers ──

/**
 * Build a match key from name + collection.
 * Templates are unique by name + collectionName.
 */
function makeMatchKey(name: string, collection: string): string {
  return `${name}|${collection || ''}`.toLowerCase();
}

// ── Template usage registration ──

/**
 * Register a template usage (field/block references a template).
 */
export async function registerTemplateUsage(
  nb: NocoBaseClient,
  templateUid: string,
  modelUid: string,
): Promise<void> {
  try {
    await nb.http.post(`${nb.baseUrl}/api/flowModelTemplateUsages:create`, {
      values: {
        uid: generateUid(),
        templateUid,
        modelUid,
      },
    });
  } catch { /* skip if already exists */ }
}
