/**
 * Export popup templates — ChildPage content referenced by popupSettings.uid.
 *
 * Templates are shared across pages (e.g., Leads detail popup used by Overview and Leads).
 * Export to templates/<uid>.yaml with full block + field_layout content.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { NocoBaseClient } from '../client';
import type { FlowModelNode } from '../types/api';
import { exportBlock } from './block-exporter';
import { dumpYaml } from '../utils/yaml';
import { slugify } from '../utils/slugify';

interface TemplateRef {
  uid: string;            // popupSettings.uid pointing to template field
  collectionName: string;
  fieldPath: string;      // field that references this template
  pageName: string;
}

/**
 * Scan all table columns for popupSettings.uid references.
 * Returns unique template refs.
 */
export async function scanPopupTemplates(
  nb: NocoBaseClient,
  routes: { schemaUid?: string; title?: string; type: string; children?: any[] }[],
): Promise<TemplateRef[]> {
  const seen = new Map<string, TemplateRef>();

  for (const route of routes) {
    if (route.type === 'group') {
      const childRefs = await scanPopupTemplates(nb, route.children || []);
      for (const ref of childRefs) {
        if (!seen.has(ref.uid)) seen.set(ref.uid, ref);
      }
      continue;
    }
    if (route.type !== 'flowPage') continue;

    const tabRoute = route.children?.find((c: any) => c.type === 'tabs');
    if (!tabRoute?.schemaUid) continue;

    try {
      const d = await nb.get({ tabSchemaUid: tabRoute.schemaUid });
      const grid = d.tree.subModels?.grid;
      if (!grid || Array.isArray(grid)) continue;

      scanGridForTemplates(grid as FlowModelNode, route.title || '', seen);
    } catch { continue; }
  }

  return [...seen.values()];
}

function scanGridForTemplates(
  grid: FlowModelNode,
  pageName: string,
  seen: Map<string, TemplateRef>,
): void {
  const rawItems = grid.subModels?.items;
  const items = (Array.isArray(rawItems) ? rawItems : []) as FlowModelNode[];

  for (const item of items) {
    if (!item.use?.includes('Table')) continue;

    const rawCols = item.subModels?.columns;
    const cols = (Array.isArray(rawCols) ? rawCols : []) as FlowModelNode[];
    const tableColl = ((item.stepParams as Record<string, unknown>)?.resourceSettings as Record<string, unknown>)
      ?.init as Record<string, unknown>;

    for (const col of cols) {
      const field = col.subModels?.field;
      if (!field || Array.isArray(field)) continue;

      const ps = ((field as FlowModelNode).stepParams as Record<string, unknown>)?.popupSettings as Record<string, unknown>;
      const openView = ps?.openView as Record<string, unknown>;
      if (!openView?.uid) continue;

      const templateUid = openView.uid as string;
      if (templateUid === (field as FlowModelNode).uid) continue; // self-reference, not a template

      const fp = ((col.stepParams as Record<string, unknown>)?.fieldSettings as Record<string, unknown>)
        ?.init as Record<string, unknown>;

      if (!seen.has(templateUid)) {
        seen.set(templateUid, {
          uid: templateUid,
          collectionName: (openView.collectionName || tableColl?.collectionName || '') as string,
          fieldPath: (fp?.fieldPath || '') as string,
          pageName,
        });
      }
    }
  }
}

/**
 * Export all popup templates to templates/ directory.
 */
export async function exportPopupTemplates(
  nb: NocoBaseClient,
  templates: TemplateRef[],
  outDir: string,
): Promise<void> {
  if (!templates.length) return;

  const tplDir = path.join(outDir, 'templates');
  fs.mkdirSync(tplDir, { recursive: true });

  const index: Record<string, unknown>[] = [];

  for (const tpl of templates) {
    try {
      const d = await nb.get({ uid: tpl.uid });
      const page = d.tree.subModels?.page;
      if (!page || Array.isArray(page)) continue;

      const pageNode = page as FlowModelNode;
      const rawTabs = pageNode.subModels?.tabs;
      const tabs = (Array.isArray(rawTabs) ? rawTabs : rawTabs ? [rawTabs] : []) as FlowModelNode[];

      const jsDir = path.join(tplDir, tpl.uid, 'js');
      fs.mkdirSync(jsDir, { recursive: true });

      const tabSpecs: Record<string, unknown>[] = [];
      for (let ti = 0; ti < tabs.length; ti++) {
        const tab = tabs[ti];
        const tabGrid = tab.subModels?.grid;
        if (!tabGrid || Array.isArray(tabGrid)) continue;

        const gridNode = tabGrid as FlowModelNode;
        const rawItems = gridNode.subModels?.items;
        const gridItems = (Array.isArray(rawItems) ? rawItems : []) as FlowModelNode[];
        const usedKeys = new Set<string>();
        const blocks: Record<string, unknown>[] = [];

        for (let i = 0; i < gridItems.length; i++) {
          const exported = exportBlock(gridItems[i], jsDir, `tpl_${tpl.uid.slice(0, 6)}`, i, usedKeys);
          if (exported) {
            const spec = { ...exported.spec };
            delete spec._popups;
            blocks.push(spec);
          }
        }

        const title = ((tab.stepParams as Record<string, unknown>)?.pageTabSettings as Record<string, unknown>)
          ?.title as Record<string, unknown>;
        tabSpecs.push({
          title: (title?.title as string) || `Tab${ti}`,
          blocks,
        });
      }

      const tplSpec: Record<string, unknown> = {
        uid: tpl.uid,
        collectionName: tpl.collectionName,
        referencedBy: `${tpl.pageName}/${tpl.fieldPath}`,
      };
      if (tabSpecs.length <= 1) {
        tplSpec.blocks = tabSpecs[0]?.blocks || [];
      } else {
        tplSpec.tabs = tabSpecs;
      }

      fs.writeFileSync(path.join(tplDir, `${tpl.uid}.yaml`), dumpYaml(tplSpec));
      index.push({
        uid: tpl.uid,
        collection: tpl.collectionName,
        referencedBy: `${tpl.pageName}/${tpl.fieldPath}`,
        blocks: tabSpecs.reduce((n, t) => n + ((t.blocks as unknown[])?.length || 0), 0),
        tabs: tabSpecs.length,
      });

      console.log(`  + template ${tpl.uid}: ${tpl.collectionName}/${tpl.fieldPath} (${tabSpecs.length} tabs)`);
    } catch (e) {
      console.log(`  ! template ${tpl.uid}: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    }
  }

  // Write index
  fs.writeFileSync(path.join(tplDir, '_index.yaml'), dumpYaml(index));
}
