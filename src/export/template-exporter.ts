/**
 * Export V2 templates (flowModelTemplates) — both popup and block templates.
 *
 * Templates are shared across pages. Export to templates/ directory:
 *   templates/
 *     _index.yaml              # all templates with metadata
 *     popup/
 *       activity_view.yaml     # popup template with content blocks
 *     block/
 *       form_add_leads.yaml    # block template with content
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { NocoBaseClient } from '../client';
import type { FlowModelNode } from '../types/api';
import { exportBlock } from './block-exporter';
import { dumpYaml } from '../utils/yaml';
import { slugify } from '../utils/slugify';

interface TemplateRecord {
  uid: string;
  name: string;
  type: 'popup' | 'block';
  collectionName: string;
  dataSourceKey: string;
  targetUid: string;
  description?: string;
  associationName?: string;
  useModel?: string;
  usageCount?: number;
}

/**
 * Export all V2 templates from flowModelTemplates API.
 */
export async function exportAllTemplates(
  nb: NocoBaseClient,
  outDir: string,
): Promise<void> {
  const tplDir = path.join(outDir, 'templates');

  // Fetch all templates
  const resp = await nb.http.get(`${nb.baseUrl}/api/flowModelTemplates:list`, {
    params: { paginate: false },
  });
  const templates = (resp.data?.data || []) as TemplateRecord[];
  if (!templates.length) {
    console.log('  No templates found');
    return;
  }

  // Create directories
  const popupDir = path.join(tplDir, 'popup');
  const blockDir = path.join(tplDir, 'block');
  fs.mkdirSync(popupDir, { recursive: true });
  fs.mkdirSync(blockDir, { recursive: true });

  const index: Record<string, unknown>[] = [];

  for (const tpl of templates) {
    const tplSlug = slugify(tpl.name || tpl.uid);
    const typeDir = tpl.type === 'popup' ? popupDir : blockDir;
    const jsDir = path.join(typeDir, `${tplSlug}_js`);

    try {
      // Read template content via targetUid
      let contentSpec: Record<string, unknown> = {};
      if (tpl.targetUid) {
        contentSpec = await exportTemplateContent(nb, tpl.targetUid, jsDir, tplSlug, tpl.type);
      }

      const tplSpec: Record<string, unknown> = {
        uid: tpl.uid,
        name: tpl.name,
        type: tpl.type,
        collectionName: tpl.collectionName || undefined,
        dataSourceKey: tpl.dataSourceKey || 'main',
        targetUid: tpl.targetUid,
        ...(tpl.associationName ? { associationName: tpl.associationName } : {}),
        ...(tpl.description ? { description: tpl.description } : {}),
        ...contentSpec,
      };

      fs.writeFileSync(path.join(typeDir, `${tplSlug}.yaml`), dumpYaml(tplSpec));

      index.push({
        uid: tpl.uid,
        name: tpl.name,
        type: tpl.type,
        collection: tpl.collectionName,
        targetUid: tpl.targetUid,
        file: `${tpl.type}/${tplSlug}.yaml`,
        usageCount: tpl.usageCount || 0,
      });

      // Clean up empty js dir
      try {
        if (fs.existsSync(jsDir) && !fs.readdirSync(jsDir).length) fs.rmdirSync(jsDir);
      } catch { /* skip */ }

    } catch (e) {
      console.log(`  ! template ${tpl.name}: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
  }

  // Write index
  fs.writeFileSync(path.join(tplDir, '_index.yaml'), dumpYaml(index));

  const popupCount = templates.filter(t => t.type === 'popup').length;
  const blockCount = templates.filter(t => t.type === 'block').length;
  console.log(`  + ${templates.length} templates (${popupCount} popup, ${blockCount} block)`);
}

/**
 * Export template content by reading the targetUid's flowModel tree.
 */
async function exportTemplateContent(
  nb: NocoBaseClient,
  targetUid: string,
  jsDir: string,
  prefix: string,
  templateType: 'popup' | 'block',
): Promise<Record<string, unknown>> {
  let tree: FlowModelNode;
  try {
    const d = await nb.get({ uid: targetUid });
    tree = d.tree;
  } catch {
    return {};
  }

  if (templateType === 'popup') {
    // Popup template: targetUid → field model → subModels.page → ChildPage → tabs → blocks
    const page = tree.subModels?.page;
    if (!page || Array.isArray(page)) {
      // Maybe targetUid IS the ChildPage directly
      if (tree.use === 'ChildPageModel') {
        return exportChildPageContent(nb, tree, jsDir, prefix);
      }
      return {};
    }
    return exportChildPageContent(nb, page as FlowModelNode, jsDir, prefix);
  } else {
    // Block template: targetUid → the actual block model (form/table/details/etc.)
    const usedKeys = new Set<string>();
    const exported = exportBlock(tree, jsDir, prefix, 0, usedKeys);
    if (!exported) return {};
    const spec = { ...exported.spec };
    delete spec._popups;
    return { content: spec };
  }
}

async function exportChildPageContent(
  nb: NocoBaseClient,
  pageNode: FlowModelNode,
  jsDir: string,
  prefix: string,
): Promise<Record<string, unknown>> {
  const rawTabs = pageNode.subModels?.tabs;
  const tabs = (Array.isArray(rawTabs) ? rawTabs : rawTabs ? [rawTabs] : []) as FlowModelNode[];

  if (tabs.length <= 1) {
    // Single tab — export blocks directly
    const tabGrid = tabs.length ? tabs[0].subModels?.grid : null;
    if (!tabGrid || Array.isArray(tabGrid)) return { content: { blocks: [] } };

    const blocks = exportGridItems(tabGrid as FlowModelNode, jsDir, prefix);
    return { content: { blocks } };
  }

  // Multi tab
  const tabSpecs: Record<string, unknown>[] = [];
  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];
    const title = ((tab.stepParams as Record<string, unknown>)?.pageTabSettings as Record<string, unknown>)
      ?.title as Record<string, unknown>;
    const tabTitle = (title?.title as string) || `Tab${i}`;
    const tabGrid = tab.subModels?.grid;
    const blocks = (tabGrid && !Array.isArray(tabGrid))
      ? exportGridItems(tabGrid as FlowModelNode, jsDir, `${prefix}_tab${i}`)
      : [];
    tabSpecs.push({ title: tabTitle, blocks });
  }
  return { content: { tabs: tabSpecs } };
}

function exportGridItems(
  grid: FlowModelNode,
  jsDir: string,
  prefix: string,
): Record<string, unknown>[] {
  const rawItems = grid.subModels?.items;
  const items = (Array.isArray(rawItems) ? rawItems : []) as FlowModelNode[];
  const usedKeys = new Set<string>();
  const blocks: Record<string, unknown>[] = [];

  for (let i = 0; i < items.length; i++) {
    const exported = exportBlock(items[i], jsDir, prefix, i, usedKeys);
    if (exported) {
      const spec = { ...exported.spec };
      delete spec._popups;
      blocks.push(spec);
    }
  }

  return blocks;
}

/**
 * Fetch template usages (which fields/blocks reference each template).
 */
export async function exportTemplateUsages(
  nb: NocoBaseClient,
  outDir: string,
): Promise<void> {
  const resp = await nb.http.get(`${nb.baseUrl}/api/flowModelTemplateUsages:list`, {
    params: { paginate: false },
  });
  const usages = (resp.data?.data || []) as { uid: string; templateUid: string; modelUid: string }[];
  if (!usages.length) return;

  fs.writeFileSync(
    path.join(outDir, 'templates', '_usages.yaml'),
    dumpYaml(usages.map(u => ({
      templateUid: u.templateUid,
      modelUid: u.modelUid,
    }))),
  );
  console.log(`  + ${usages.length} template usages`);
}
