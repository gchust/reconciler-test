/**
 * Build project graph from exported directory structure.
 *
 * Scans: routes.yaml, collections/, pages/**, templates/
 * Produces: ProjectGraph with all nodes and edges.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProjectGraph, type GraphNode, type GraphEdge } from './project-graph';
import { loadYaml } from '../utils/yaml';
import { slugify } from '../utils/slugify';

/**
 * Build graph from an exported project directory.
 */
export function buildGraph(projectDir: string): ProjectGraph {
  const graph = new ProjectGraph();
  const root = path.resolve(projectDir);

  // 1. Collections
  const collDir = path.join(root, 'collections');
  if (fs.existsSync(collDir)) {
    for (const f of fs.readdirSync(collDir).filter(f => f.endsWith('.yaml'))) {
      const coll = loadYaml<Record<string, unknown>>(path.join(collDir, f));
      const name = (coll.name as string) || f.replace('.yaml', '');
      graph.addNode({ id: `collection:${name}`, type: 'collection', name, meta: { file: `collections/${f}` } });

      // Field references (m2o → target collection)
      for (const field of (coll.fields || []) as Record<string, unknown>[]) {
        if (field.interface === 'm2o' && field.target) {
          graph.addEdge({
            from: `collection:${name}`,
            to: `collection:${field.target}`,
            type: 'references',
            meta: { field: field.name, relation: 'm2o' },
          });
        }
        if (field.interface === 'o2m' && field.target) {
          graph.addEdge({
            from: `collection:${name}`,
            to: `collection:${field.target}`,
            type: 'references',
            meta: { field: field.name, relation: 'o2m' },
          });
        }
      }
    }
  }

  // 2. Components (templates)
  const tplDir = path.join(root, 'templates');
  if (fs.existsSync(path.join(tplDir, '_index.yaml'))) {
    const index = loadYaml<Record<string, unknown>[]>(path.join(tplDir, '_index.yaml')) || [];
    for (const tpl of index) {
      const id = `component:${tpl.uid}`;
      graph.addNode({
        id,
        type: 'component',
        name: tpl.name as string || tpl.uid as string,
        meta: { uid: tpl.uid, type: tpl.type, collection: tpl.collection, file: `templates/${tpl.file}` },
      });
      // Component → collection
      if (tpl.collection) {
        graph.addEdge({ from: id, to: `collection:${tpl.collection}`, type: 'belongsTo' });
      }
    }
  }

  // 3. Pages (recursive scan)
  const pagesDir = path.join(root, 'pages');
  if (fs.existsSync(pagesDir)) {
    scanPagesDir(graph, pagesDir, root);
  }

  return graph;
}

function scanPagesDir(graph: ProjectGraph, dir: string, root: string, parentGroup?: string): void {
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    if (!fs.statSync(fullPath).isDirectory()) continue;

    const layoutFile = path.join(fullPath, 'layout.yaml');
    const pageFile = path.join(fullPath, 'page.yaml');

    // Check for tab_* subdirs (multi-tab page)
    const tabDirs = fs.readdirSync(fullPath).filter(d => d.startsWith('tab_') && fs.statSync(path.join(fullPath, d)).isDirectory());

    if (fs.existsSync(layoutFile) || tabDirs.length) {
      // It's a page
      const pageName = entry;
      const pageId = `page:${parentGroup ? parentGroup + '/' : ''}${pageName}`;
      graph.addNode({
        id: pageId,
        type: 'page',
        name: pageName,
        meta: { dir: path.relative(root, fullPath), group: parentGroup },
      });

      // Scan layout.yaml
      if (fs.existsSync(layoutFile)) {
        scanLayout(graph, pageId, layoutFile, root);
      }
      // Scan tab layouts
      for (const td of tabDirs) {
        const tabLayout = path.join(fullPath, td, 'layout.yaml');
        if (fs.existsSync(tabLayout)) {
          scanLayout(graph, pageId, tabLayout, root);
        }
      }
    } else {
      // It's a group — recurse
      scanPagesDir(graph, fullPath, root, entry);
    }
  }
}

function scanLayout(graph: ProjectGraph, pageId: string, layoutFile: string, root: string): void {
  const layout = loadYaml<Record<string, unknown>>(layoutFile);
  const blocks = (layout.blocks || []) as Record<string, unknown>[];

  for (const block of blocks) {
    const blockKey = block.key as string || block.type as string;
    const blockId = `${pageId}/${blockKey}`;
    graph.addNode({
      id: blockId,
      type: 'block',
      name: `${blockKey} (${block.type})`,
      meta: { type: block.type, coll: block.coll },
    });
    graph.addEdge({ from: pageId, to: blockId, type: 'contains' });

    // Block → collection
    if (block.coll) {
      graph.addEdge({ from: blockId, to: `collection:${block.coll}`, type: 'belongsTo' });
    }

    // Scan fields for clickToOpen popups
    const fields = (block.fields || []) as unknown[];
    for (const f of fields) {
      if (typeof f !== 'object') continue;
      const fo = f as Record<string, unknown>;
      if (!fo.clickToOpen) continue;

      const popup = fo.popup as Record<string, unknown>;
      const ps = fo.popupSettings as Record<string, unknown>;
      const popupColl = popup?.collectionName || ps?.collectionName;

      if (popupColl) {
        // Page → popupTo → collection
        graph.addEdge({
          from: pageId,
          to: `collection:${popupColl}`,
          type: 'popupTo',
          meta: { field: fo.field, depth: 0 },
        });
      }

      // Template reference
      const templateName = popup?._template as string;
      if (templateName) {
        // Find component by name
        const compNode = [...(graph as any).nodes.values()].find(
          (n: GraphNode) => n.type === 'component' && n.name === templateName,
        );
        if (compNode) {
          graph.addEdge({ from: blockId, to: compNode.id, type: 'usesComponent' });
        }
      }
    }

    // Scan actions for popup refs
    for (const actionKey of ['actions', 'recordActions'] as const) {
      const actions = (block[actionKey] || []) as unknown[];
      for (const a of actions) {
        if (typeof a !== 'object') continue;
        const ao = a as Record<string, unknown>;
        if (ao.type === 'ai' && ao.employee) {
          // AI button → no graph edge needed
        }
      }
    }

    // Chart/KPI → collection (dataSource)
    if (block.type === 'chart' || block.type === 'jsBlock') {
      if (block.coll) {
        graph.addEdge({ from: blockId, to: `collection:${block.coll}`, type: 'dataSource' });
      }
    }
  }
}
