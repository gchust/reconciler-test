/**
 * Module scaffold — generate NEW DSL format project skeleton.
 *
 * Usage: cli.ts scaffold <dir> <module-name> --pages Dashboard,Projects,Tasks
 *        --collections nb_pm_projects,nb_pm_tasks
 *
 * Generates:
 *   routes.yaml, defaults.yaml, state.yaml,
 *   collections/, templates/block/, pages/<mod>/<page>/layout.yaml + popups/
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from '../utils/slugify';
import { dumpYaml } from '../utils/yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Dashboard constants (reusable templates) ──

const KPI_COLORS = [
  { key: 'kpi_1', color: '#3b82f6', bg: '#eff6ff', stroke: '#bfdbfe', label: 'Total Records' },
  { key: 'kpi_2', color: '#10b981', bg: '#ecfdf5', stroke: '#6ee7b7', label: 'Active Rate' },
  { key: 'kpi_3', color: '#f59e0b', bg: '#fffbeb', stroke: '#fcd34d', label: 'Pending Items' },
  { key: 'kpi_4', color: '#8b5cf6', bg: '#f5f3ff', stroke: '#c4b5fd', label: 'Completed' },
];

const CHART_TYPES = [
  { key: 'chart_1', type: 'bar',  desc: 'Bar Chart — count by category' },
  { key: 'chart_2', type: 'pie',  desc: 'Pie Chart — distribution by status' },
  { key: 'chart_3', type: 'line', desc: 'Line Chart — trend over time' },
  { key: 'chart_4', type: 'bar',  desc: 'Stacked Bar — breakdown comparison' },
  { key: 'chart_5', type: 'pie',  desc: 'Donut Chart — proportion overview' },
];

const CHART_RENDERS: Record<string, string> = {
  bar: "var data = ctx.data.objects || [];\nreturn {\n  title: { text: 'TITLE', left: 'center', textStyle: { fontSize: 14 } },\n  tooltip: { trigger: 'axis' },\n  xAxis: { type: 'category', data: data.map(function(d) { return d.label; }), axisLabel: { rotate: 30 } },\n  yAxis: { type: 'value' },\n  series: [{ type: 'bar', data: data.map(function(d) { return d.value; }), itemStyle: { color: '#1677ff' } }]\n};",
  pie: "var data = ctx.data.objects || [];\nreturn {\n  title: { text: 'TITLE', left: 'center', textStyle: { fontSize: 14 } },\n  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },\n  series: [{ type: 'pie', radius: ['40%', '70%'], data: data.map(function(d) { return { name: d.label, value: d.value }; }), label: { show: true, formatter: '{b}\\n{d}%' } }]\n};",
  line: "var data = ctx.data.objects || [];\nreturn {\n  title: { text: 'TITLE', left: 'center', textStyle: { fontSize: 14 } },\n  tooltip: { trigger: 'axis' },\n  xAxis: { type: 'category', data: data.map(function(d) { return d.label; }) },\n  yAxis: { type: 'value' },\n  series: [{ type: 'line', data: data.map(function(d) { return d.value; }), smooth: true, areaStyle: { opacity: 0.1 }, itemStyle: { color: '#1677ff' } }]\n};",
};

// ── KPI card JS template (CRM-style) ──

function generateKpiJs(
  modSlug: string,
  index: number,
  kpi: typeof KPI_COLORS[0],
): string {
  return `// KPI Card ${index + 1}: ${kpi.label}
const { useState, useEffect } = ctx.React;
const SQL_UID = '${modSlug}_kpi_${index + 1}';

const cardStyle = {
  borderRadius: '0', padding: '24px', position: 'relative', overflow: 'hidden',
  border: 'none', boxShadow: 'none',
  margin: '-24px', height: 'calc(100% + 48px)', width: 'calc(100% + 48px)',
  display: 'flex', flexDirection: 'column', cursor: 'pointer'
};
const labelStyle = { fontSize: '0.875rem', fontWeight: '500', zIndex: 2 };
const valueStyle = { fontSize: '2rem', fontWeight: '700', marginTop: 'auto', zIndex: 2, letterSpacing: '-0.03em', color: '${kpi.color}' };
const trendStyle = { fontSize: '0.75rem', padding: '2px 8px', borderRadius: '99px', fontWeight: '600', background: '${kpi.bg}', color: '${kpi.color}' };
const bgChartStyle = { position: 'absolute', bottom: 0, right: 0, width: '140px', height: '90px', zIndex: 1, opacity: 0.5, pointerEvents: 'none' };

const KpiCard = () => {
  const [data, setData] = useState({ value: 0, growth: 0, loading: true });
  useEffect(() => { fetchData(); }, []);
  const fetchData = async () => {
    try {
      setData(prev => ({ ...prev, loading: true }));
      // TODO: implement SQL query via ctx.sql.runById(SQL_UID, { ... })
      setData({ value: 0, growth: 0, loading: false });
    } catch (e) { console.error(e); setData(prev => ({ ...prev, loading: false })); }
  };

  const fmt = (v) => v >= 1e6 ? (v/1e6).toFixed(1) + 'M' : v >= 1e3 ? (v/1e3).toFixed(1) + 'K' : String(v);

  return ctx.React.createElement('div', { className: 'kpi-card-hover', style: cardStyle },
    ctx.React.createElement('div', { style: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', zIndex:2 } },
      ctx.React.createElement('span', { style: labelStyle }, '${kpi.label}'),
      ctx.React.createElement('span', { style: trendStyle }, data.growth >= 0 ? '+' + data.growth.toFixed(1) + '%' : data.growth.toFixed(1) + '%')
    ),
    ctx.React.createElement('div', { style: valueStyle }, data.loading ? '...' : fmt(data.value)),
    ctx.React.createElement('svg', { style: bgChartStyle, viewBox:'0 0 100 50', preserveAspectRatio:'none' },
      ctx.React.createElement('path', { d:'M0,50 L0,30 Q25,10 50,25 T100,15 L100,50 Z', fill:'${kpi.bg}', stroke:'${kpi.stroke}', strokeWidth:'2' }))
  );
};
ctx.render(ctx.React.createElement(ctx.React.Fragment, null,
  ctx.React.createElement('style', null, ':has(> .kpi-card-hover),:has(> div > .kpi-card-hover){overflow:hidden!important}.kpi-card-hover{transition:transform .2s ease;transform:scale(0.97)}.kpi-card-hover:hover{transform:scale(1)}'),
  ctx.React.createElement(KpiCard, null)
));
`;
}

// ── Icon mapping for common page names ──

const PAGE_ICONS: Record<string, string> = {
  dashboard: 'dashboardoutlined',
  analytics: 'areachartoutlined',
  overview: 'calendaroutlined',
  projects: 'fundprojectscreenoutlined',
  tasks: 'checksquareoutlined',
  milestones: 'flagoutlined',
  members: 'teamoutlined',
  users: 'teamoutlined',
  timeentries: 'clockcircleoutlined',
  time_entries: 'clockcircleoutlined',
  bugs: 'bugoutlined',
  issues: 'warningoutlined',
  orders: 'shoppingcartoutlined',
  products: 'appstoreoutlined',
  customers: 'teamoutlined',
  leads: 'useraddoutlined',
  settings: 'settingoutlined',
  reports: 'barchartoutlined',
};

function iconForPage(pageName: string): string {
  const key = slugify(pageName);
  return PAGE_ICONS[key] || 'fileoutlined';
}

// ── Main scaffold function ──

export function scaffold(
  modDir: string,
  moduleName: string,
  pages: string[],
  collections: string[] | undefined,
  log: (msg: string) => void = console.log,
): void {
  const root = path.resolve(modDir);
  const modSlug = slugify(moduleName);

  // Resolve collection names: explicit list or auto-generate from pages
  const nonDashboardPages = pages.filter(p => !p.toLowerCase().includes('dashboard'));
  const collNames: string[] = collections && collections.length
    ? collections
    : nonDashboardPages.map(p => `nb_${modSlug}_${slugify(p)}`);

  // Map page -> collection (skip dashboard)
  const pageCollMap: Record<string, string> = {};
  for (let i = 0; i < nonDashboardPages.length; i++) {
    const pageKey = slugify(nonDashboardPages[i]);
    pageCollMap[pageKey] = collNames[i] || `nb_${modSlug}_${pageKey}`;
  }

  // ── Create directories ──

  const dirs = [
    root,
    path.join(root, 'collections'),
    path.join(root, 'templates', 'block'),
    path.join(root, 'templates', 'popup'),
  ];

  // Page directories
  for (const pageName of pages) {
    const pageSlug = slugify(pageName);
    const pageDir = path.join(root, 'pages', modSlug, pageSlug);
    dirs.push(pageDir);
    dirs.push(path.join(pageDir, 'js'));
    if (pageName.toLowerCase().includes('dashboard')) {
      dirs.push(path.join(pageDir, 'charts'));
    } else {
      dirs.push(path.join(pageDir, 'popups'));
    }
  }

  for (const d of dirs) {
    fs.mkdirSync(d, { recursive: true });
  }

  // ── 1. routes.yaml ──

  const routeChildren: Record<string, unknown>[] = pages.map(p => {
    const entry: Record<string, unknown> = { title: p, icon: iconForPage(p) };
    return entry;
  });

  const routes = [{
    title: moduleName,
    type: 'group',
    icon: 'projectoutlined',
    children: routeChildren,
  }];

  fs.writeFileSync(path.join(root, 'routes.yaml'), dumpYaml(routes));

  // ── 2. defaults.yaml ──

  const defaults: Record<string, Record<string, string>> = { popups: {}, forms: {} };
  for (const collName of collNames) {
    defaults.popups[collName] = `templates/popup/detail_${collName}.yaml`;
    defaults.forms[collName] = `templates/block/form_add_new_${collName}.yaml`;
  }
  fs.writeFileSync(path.join(root, 'defaults.yaml'), dumpYaml(defaults));

  // ── 3. state.yaml ──

  fs.writeFileSync(path.join(root, 'state.yaml'), dumpYaml({ pages: {} }));

  // ── 4. collections/*.yaml ──

  for (const collName of collNames) {
    // Derive display title from collection name
    const shortName = collName.replace(`nb_${modSlug}_`, '');
    const title = shortName
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    const collSpec = {
      name: collName,
      title,
      fields: [
        { name: 'name', interface: 'input', title: 'Name' },
        { name: 'status', interface: 'select', title: 'Status' },
        { name: 'description', interface: 'textarea', title: 'Description' },
      ],
    };

    fs.writeFileSync(
      path.join(root, 'collections', `${collName}.yaml`),
      dumpYaml(collSpec),
    );
  }

  // ── 5. templates (block + popup) per collection ──
  // Each CRUD operation gets both a block template AND a popup template.
  // Block template = the form/detail block itself (reusable content).
  // Popup template = the whole popup (drawer with block inside, reusable as popupTemplateUid).
  // First-time generation: addNew, edit, detail all share the same field_layout.

  for (const collName of collNames) {
    const shortName = collName.replace(`nb_${modSlug}_`, '');
    const title = shortName
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    const sharedFields = ['name', 'status', 'description'];
    const sharedLayout = [
      '--- Basic Info ---',
      ['name', 'status'],
      ['description'],
    ];

    // Block templates (the form/detail block itself)
    fs.writeFileSync(
      path.join(root, 'templates', 'block', `form_add_new_${collName}.yaml`),
      dumpYaml({
        name: `Form (Add new): ${title}`,
        type: 'block',
        collectionName: collName,
        content: {
          key: 'createForm', type: 'createForm', coll: collName,
          fields: sharedFields, field_layout: sharedLayout,
          actions: ['submit'],
        },
      }),
    );

    fs.writeFileSync(
      path.join(root, 'templates', 'block', `form_edit_${collName}.yaml`),
      dumpYaml({
        name: `Form (Edit): ${title}`,
        type: 'block',
        collectionName: collName,
        content: {
          key: 'editForm', type: 'editForm', coll: collName,
          resource_binding: { filterByTk: '{{ctx.view.inputArgs.filterByTk}}' },
          fields: sharedFields, field_layout: sharedLayout,
          actions: ['submit'],
        },
      }),
    );

    fs.writeFileSync(
      path.join(root, 'templates', 'block', `detail_${collName}.yaml`),
      dumpYaml({
        name: `Detail: ${title}`,
        type: 'block',
        collectionName: collName,
        content: {
          key: 'details', type: 'details', coll: collName,
          resource_binding: { filterByTk: '{{ctx.view.inputArgs.filterByTk}}' },
          fields: sharedFields, field_layout: sharedLayout,
          actions: ['edit'],
        },
      }),
    );

    // Popup templates (whole drawer — deferred creation: deploy inline → saveTemplate)
    fs.writeFileSync(
      path.join(root, 'templates', 'popup', `add_new_${collName}.yaml`),
      dumpYaml({
        name: `Popup (Add new): ${title}`,
        type: 'popup',
        collectionName: collName,
        content: {
          blocks: [{ ref: `templates/block/form_add_new_${collName}.yaml` }],
        },
      }),
    );

    fs.writeFileSync(
      path.join(root, 'templates', 'popup', `edit_${collName}.yaml`),
      dumpYaml({
        name: `Popup (Edit): ${title}`,
        type: 'popup',
        collectionName: collName,
        content: {
          blocks: [{ ref: `templates/block/form_edit_${collName}.yaml` }],
        },
      }),
    );

    fs.writeFileSync(
      path.join(root, 'templates', 'popup', `detail_${collName}.yaml`),
      dumpYaml({
        name: `Popup (Detail): ${title}`,
        type: 'popup',
        collectionName: collName,
        content: {
          blocks: [{ ref: `templates/block/detail_${collName}.yaml` }],
        },
      }),
    );
  }

  // ── 6. pages ──

  for (const pageName of pages) {
    const pageSlug = slugify(pageName);
    const pageDir = path.join(root, 'pages', modSlug, pageSlug);
    const isDashboard = pageName.toLowerCase().includes('dashboard');

    if (isDashboard) {
      generateDashboardPage(pageDir, modSlug, collNames[0] || `nb_${modSlug}_TODO`);
    } else {
      const coll = pageCollMap[pageSlug] || `nb_${modSlug}_${pageSlug}`;
      generateCrudPage(pageDir, pageName, coll, modSlug);
    }
  }

  // ── Print summary ──

  log(`\n  Scaffold created: ${modDir}/`);
  log(`  Format: NEW DSL (routes.yaml + pages/ + collections/ + templates/)`);
  log(`  ${pages.length} pages: ${pages.join(', ')}`);
  log(`  ${collNames.length} collections: ${collNames.join(', ')}`);
  log(`\n  Next steps:`);
  log(`    1. Edit collections/*.yaml — add fields to each collection`);
  log(`    2. Edit pages/**/layout.yaml — customize blocks, fields, layout`);
  log(`    3. Edit templates/block/ — customize form field_layout`);
  log(`    4. Deploy: cli.ts deploy-project ${modDir}/ --group "${moduleName}" --blueprint`);
}

// ── Dashboard page generator ──

function generateDashboardPage(
  pageDir: string,
  modSlug: string,
  firstColl: string,
): void {
  // Generate KPI JS files
  for (let i = 0; i < KPI_COLORS.length; i++) {
    const kpi = KPI_COLORS[i];
    const js = generateKpiJs(modSlug, i, kpi);
    fs.writeFileSync(path.join(pageDir, 'js', `${kpi.key}.js`), js);
  }

  // Generate chart configs + SQL + render JS
  for (const chart of CHART_TYPES) {
    // Chart config YAML
    fs.writeFileSync(
      path.join(pageDir, 'charts', `${chart.key}.yaml`),
      dumpYaml({
        sql_file: `./charts/${chart.key}.sql`,
        render_file: `./charts/${chart.key}_render.js`,
      }),
    );

    // Chart SQL
    fs.writeFileSync(
      path.join(pageDir, 'charts', `${chart.key}.sql`),
      `-- ${chart.desc}\n-- TODO: Replace with real query against ${firstColl}\nSELECT 'Category A' AS label, 10 AS value\nUNION ALL SELECT 'Category B', 20\nUNION ALL SELECT 'Category C', 15\nUNION ALL SELECT 'Category D', 8\n`,
    );

    // Chart render JS
    const renderJs = (CHART_RENDERS[chart.type] || CHART_RENDERS.bar)
      .replace('TITLE', chart.desc.split(' — ')[0]);
    fs.writeFileSync(
      path.join(pageDir, 'charts', `${chart.key}_render.js`),
      renderJs,
    );
  }

  // Dashboard layout.yaml
  const layout = {
    blocks: [
      ...KPI_COLORS.map(kpi => ({
        key: kpi.key,
        js: `./js/${kpi.key}.js`,
      })),
      ...CHART_TYPES.map(chart => ({
        key: chart.key,
        type: 'chart',
        chart_config: `./charts/${chart.key}.yaml`,
      })),
    ],
    layout: [
      [{ kpi_1: 6 }, { kpi_2: 6 }, { kpi_3: 6 }, { kpi_4: 6 }],
      [{ chart_1: 15 }, { chart_2: 9 }],
      ['chart_3'],
      [{ chart_4: 14 }, { chart_5: 10 }],
    ],
  };

  fs.writeFileSync(path.join(pageDir, 'layout.yaml'), dumpYaml(layout));
}

// ── CRUD page generator ──

function generateCrudPage(
  pageDir: string,
  pageName: string,
  coll: string,
  modSlug: string,
): void {
  // layout.yaml
  const layout = {
    blocks: [
      {
        key: 'filterForm',
        type: 'filterForm',
        coll,
        fields: [
          {
            field: 'name',
            label: 'Search',
            filterPaths: ['name', 'description'],
          },
          'status',
        ],
        js_items: [
          {
            key: 'stats_filter',
            desc: 'Stats Filter Block',
            file: `./js/stats_filter.js`,
          },
        ],
        field_layout: [
          ['[JS:Stats Filter Block]'],
          ['name', 'status'],
        ],
      },
      {
        key: 'table',
        type: 'table',
        coll,
        fields: [
          { field: 'name', popup: true },  // popup file table.name.yaml handles content
          'status',
          'createdAt',
        ],
        actions: ['filter', 'refresh', 'addNew'],
        recordActions: ['edit'],
      },
    ],
    layout: [
      ['filterForm'],
      ['table'],
    ],
  };

  fs.writeFileSync(path.join(pageDir, 'layout.yaml'), dumpYaml(layout));

  // js/stats_filter.js — copy from template + fill parameters
  const tplRoot = path.join(__dirname, '..', '..', 'templates', 'js');
  const { fillTemplate } = await import('../utils/template-filler');
  const statsFilterTpl = path.join(tplRoot, 'stats-filter.js');
  const statsFilterJs = fs.existsSync(statsFilterTpl)
    ? fillTemplate(fs.readFileSync(statsFilterTpl, 'utf8'), { COLLECTION: coll })
    : `// stats-filter template not found\nctx.render(null);`;
  fs.writeFileSync(path.join(pageDir, 'js', 'stats_filter.js'), statsFilterJs);

  // popups — reference popup templates
  fs.writeFileSync(
    path.join(pageDir, 'popups', 'table.addNew.yaml'),
    dumpYaml({
      target: '$SELF.table.actions.addNew',
      popup: `templates/popup/add_new_${coll}.yaml`,
    }),
  );

  fs.writeFileSync(
    path.join(pageDir, 'popups', 'table.edit.yaml'),
    dumpYaml({
      target: '$SELF.table.recordActions.edit',
      popup: `templates/popup/edit_${coll}.yaml`,
    }),
  );

  fs.writeFileSync(
    path.join(pageDir, 'popups', 'table.name.yaml'),
    dumpYaml({
      target: '$SELF.table.fields.name',
      popup: `templates/popup/detail_${coll}.yaml`,
    }),
  );
}
