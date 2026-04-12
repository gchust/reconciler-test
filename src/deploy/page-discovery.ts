/**
 * Discover pages from directory tree based on routes.yaml.
 *
 * Pure filesystem functions — no NocoBase API calls.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PageSpec, BlockSpec, PopupSpec } from '../types/spec';
import { loadYaml } from '../utils/yaml';
import { slugify } from '../utils/slugify';

export interface RouteEntry {
  title: string;
  type: 'group' | 'flowPage';
  icon?: string;
  children?: RouteEntry[];
}

export interface PageInfo {
  title: string;
  icon: string;
  slug: string;
  dir: string;          // absolute path to page directory
  layout: PageSpec;      // parsed layout.yaml (blocks + layout)
  popups: PopupSpec[];   // parsed popups/*.yaml
  pageMeta: Record<string, unknown>;
}

/**
 * Discover all pages from directory tree, guided by routes.yaml structure.
 */
export function discoverPages(
  pagesDir: string,
  routes: RouteEntry[],
  filterGroup?: string,
): PageInfo[] {
  const pages: PageInfo[] = [];
  if (!fs.existsSync(pagesDir)) return pages;

  for (const routeEntry of routes) {
    if (routeEntry.type === 'group') {
      if (filterGroup && routeEntry.title !== filterGroup) continue;
      const groupSlug = slugify(routeEntry.title);
      const groupDir = path.join(pagesDir, groupSlug);
      if (!fs.existsSync(groupDir)) continue;

      for (const child of routeEntry.children || []) {
        if (child.type === 'flowPage') {
          const p = readPageDir(path.join(groupDir, slugify(child.title)), child.title, child.icon);
          if (p) pages.push(p);
        } else if (child.type === 'group') {
          const subDir = path.join(groupDir, slugify(child.title));
          for (const sc of child.children || []) {
            if (sc.type === 'flowPage') {
              const p = readPageDir(path.join(subDir, slugify(sc.title)), sc.title, sc.icon);
              if (p) pages.push(p);
            }
          }
        }
      }
    } else if (routeEntry.type === 'flowPage' && !filterGroup) {
      const p = readPageDir(path.join(pagesDir, slugify(routeEntry.title)), routeEntry.title, routeEntry.icon);
      if (p) pages.push(p);
    }
  }

  return pages;
}

/**
 * Read a single page directory and parse its spec files.
 */
export function readPageDir(pageDir: string, title: string, icon?: string): PageInfo | null {
  if (!fs.existsSync(pageDir)) return null;

  const pageMeta = fs.existsSync(path.join(pageDir, 'page.yaml'))
    ? loadYaml<Record<string, unknown>>(path.join(pageDir, 'page.yaml'))
    : {};

  const layoutFile = path.join(pageDir, 'layout.yaml');

  // Check for multi-tab page (has tab_* subdirs but no layout.yaml)
  const tabDirs = fs.existsSync(pageDir)
    ? fs.readdirSync(pageDir).filter(d => d.startsWith('tab_') && fs.statSync(path.join(pageDir, d)).isDirectory()).sort()
    : [];

  let layout: PageSpec;

  if (fs.existsSync(layoutFile)) {
    // Single tab page
    const layoutRaw = loadYaml<Record<string, unknown>>(layoutFile);
    layout = {
      page: title,
      icon: icon || (pageMeta.icon as string) || 'fileoutlined',
      coll: layoutRaw.coll as string || '',
      blocks: (layoutRaw.blocks || []) as BlockSpec[],
      layout: layoutRaw.layout as PageSpec['layout'],
    };
  } else if (tabDirs.length) {
    // Multi-tab page — first tab becomes the main layout, others become tabs
    const tabs: { title: string; blocks: BlockSpec[]; layout?: PageSpec['layout'] }[] = [];
    for (const td of tabDirs) {
      const tabLayout = path.join(pageDir, td, 'layout.yaml');
      if (!fs.existsSync(tabLayout)) continue;
      const tabRaw = loadYaml<Record<string, unknown>>(tabLayout);
      const tabTitle = td.replace('tab_', '').replace(/_/g, ' ');
      tabs.push({
        title: tabTitle,
        blocks: (tabRaw.blocks || []) as BlockSpec[],
        layout: tabRaw.layout as PageSpec['layout'],
      });
    }
    if (!tabs.length) return null;

    // Use first tab as main page blocks
    layout = {
      page: title,
      icon: icon || (pageMeta.icon as string) || 'fileoutlined',
      blocks: tabs[0].blocks,
      layout: tabs[0].layout,
      tabs: tabs.length > 1 ? tabs.map(t => ({
        title: t.title,
        blocks: t.blocks,
      })) : undefined,
    };
  } else {
    return null;
  }

  // Read popups (from page dir and all tab dirs)
  const popups: PopupSpec[] = [];
  const popupDirs = [path.join(pageDir, 'popups')];
  for (const td of tabDirs) {
    popupDirs.push(path.join(pageDir, td, 'popups'));
  }
  for (const popupsDir of popupDirs) {
    if (!fs.existsSync(popupsDir)) continue;
    for (const f of fs.readdirSync(popupsDir).filter(f => f.endsWith('.yaml')).sort()) {
      try {
        const ps = loadYaml<PopupSpec>(path.join(popupsDir, f));
        if (ps.target) popups.push(ps);
      } catch { /* skip malformed popup file */ }
    }
  }

  return {
    title,
    icon: icon || (pageMeta.icon as string) || 'fileoutlined',
    slug: slugify(title),
    dir: pageDir,
    layout,
    popups,
    pageMeta,
  };
}
