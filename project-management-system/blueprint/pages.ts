import {
  app,
  chart,
  field,
  filterForm,
  group,
  jsBlock,
  page,
  route,
  table,
} from '../../src/dsl';
import type { FieldInput, LayoutRow, PageDefNode } from '../../src/dsl';

interface CrudPageOptions {
  title: string;
  icon: string;
  coll: string;
  viewField: string;
  searchPaths: string[];
  filterFields: FieldInput[];
  filterLayout: (LayoutRow | string)[];
  tableFields: FieldInput[];
}

function buildCrudPage(options: CrudPageOptions): PageDefNode {
  return page(options.title, {
    icon: options.icon,
    coll: options.coll,
    blocks: [
      filterForm('filter', options.coll, {
        fields: [
          field(options.viewField, {
            label: '搜索',
            filterPaths: options.searchPaths,
          }),
          ...options.filterFields,
        ],
        actions: ['submit', 'reset'],
        fieldLayout: options.filterLayout,
      }),
      table('table', options.coll, {
        fields: [
          field(options.viewField, { clickToOpen: true }),
          ...options.tableFields,
        ],
        actions: ['filter', 'refresh', 'addNew', 'export'],
        recordActions: ['edit', 'view', 'delete'],
      }),
    ],
    layout: [['filter'], ['table']],
  });
}

export const dashboardPage = page('Dashboard', {
  icon: 'dashboardoutlined',
  blocks: [
    jsBlock('./js/project_overview_kpi.js', {
      key: 'project_overview_kpi',
      desc: 'Project Overview KPI',
    }),
    chart('./charts/projects_status.yaml', { key: 'chart_projects_status' }),
    chart('./charts/tasks_status.yaml', { key: 'chart_tasks_status' }),
    chart('./charts/milestones_status.yaml', { key: 'chart_milestones_status' }),
    chart('./charts/member_status.yaml', { key: 'chart_member_status' }),
    chart('./charts/time_entries_billable.yaml', { key: 'chart_time_entries_billable' }),
    table('active_projects', 'nb_pm_projects', {
      title: '进行中的项目',
      fields: [
        field('name', { clickToOpen: true }),
        'owner',
        'client_name',
        'end_date',
        'progress',
        'status',
      ],
      actions: ['refresh'],
      dataScope: { status: 'active' },
      pageSize: 8,
    }),
    table('my_tasks', 'nb_pm_tasks', {
      title: '待跟进任务',
      fields: [
        field('title', { clickToOpen: true }),
        'project',
        'assignee',
        'due_date',
        'priority',
        'status',
      ],
      actions: ['refresh'],
      dataScope: {
        status: {
          $in: ['todo', 'in_progress', 'blocked'],
        },
      },
      pageSize: 8,
    }),
    table('upcoming_milestones', 'nb_pm_milestones', {
      title: '近期里程碑',
      fields: [
        field('name', { clickToOpen: true }),
        'project',
        'owner',
        'planned_date',
        'status',
      ],
      actions: ['refresh'],
      dataScope: {
        status: {
          $in: ['pending', 'in_progress', 'delayed'],
        },
      },
      pageSize: 8,
    }),
  ],
  layout: [
    ['project_overview_kpi'],
    [
      { chart_projects_status: 8 },
      { chart_tasks_status: 8 },
      { chart_milestones_status: 8 },
    ],
    [
      { chart_member_status: 12 },
      { chart_time_entries_billable: 12 },
    ],
    ['active_projects'],
    [
      { my_tasks: 14 },
      { upcoming_milestones: 10 },
    ],
  ],
});

export const projectsPage = buildCrudPage({
  title: 'Projects',
  icon: 'projectoutlined',
  coll: 'nb_pm_projects',
  viewField: 'name',
  searchPaths: ['name', 'code', 'client_name', 'owner'],
  filterFields: ['status', 'priority', 'owner'],
  filterLayout: [
    ['name'],
    ['status', 'priority', 'owner'],
  ],
  tableFields: [
    'code',
    'owner',
    'client_name',
    'end_date',
    'progress',
    'priority',
    'status',
  ],
});

export const tasksPage = buildCrudPage({
  title: 'Tasks',
  icon: 'profileoutlined',
  coll: 'nb_pm_tasks',
  viewField: 'title',
  searchPaths: ['title', 'task_no', 'assignee'],
  filterFields: ['status', 'priority', 'project', 'assignee'],
  filterLayout: [
    ['title'],
    ['status', 'priority', 'project'],
    ['assignee'],
  ],
  tableFields: [
    'task_no',
    'project',
    'assignee',
    'due_date',
    'planned_hours',
    'actual_hours',
    'status',
  ],
});

export const milestonesPage = buildCrudPage({
  title: 'Milestones',
  icon: 'flagoutlined',
  coll: 'nb_pm_milestones',
  viewField: 'name',
  searchPaths: ['name', 'owner'],
  filterFields: ['status', 'project', 'owner'],
  filterLayout: [
    ['name'],
    ['status', 'project', 'owner'],
  ],
  tableFields: [
    'project',
    'owner',
    'planned_date',
    'completed_date',
    'status',
  ],
});

export const membersPage = buildCrudPage({
  title: 'Members',
  icon: 'teamoutlined',
  coll: 'nb_pm_members',
  viewField: 'name',
  searchPaths: ['name', 'employee_no', 'email', 'phone'],
  filterFields: ['status', 'department', 'role_name'],
  filterLayout: [
    ['name'],
    ['status', 'department', 'role_name'],
  ],
  tableFields: [
    'employee_no',
    'role_name',
    'department',
    'email',
    'phone',
    'status',
  ],
});

export const timeEntriesPage = buildCrudPage({
  title: 'Time Entries',
  icon: 'clockcircleoutlined',
  coll: 'nb_pm_time_entries',
  viewField: 'entry_no',
  searchPaths: ['entry_no', 'member_name'],
  filterFields: ['status', 'project', 'billable'],
  filterLayout: [
    ['entry_no'],
    ['status', 'project', 'billable'],
  ],
  tableFields: [
    'project',
    'task',
    'member_name',
    'work_date',
    'hours',
    'billable',
    'status',
  ],
});

export const projectManagementApp = app('Project Management 项目管理系统', {
  routes: [
    group('项目管理', 'projectoutlined', [
      route('Dashboard', 'dashboardoutlined', dashboardPage),
      route('Projects', 'projectoutlined', projectsPage),
      route('Tasks', 'profileoutlined', tasksPage),
      route('Milestones', 'flagoutlined', milestonesPage),
      route('Members', 'teamoutlined', membersPage),
      route('Time Entries', 'clockcircleoutlined', timeEntriesPage),
    ]),
  ],
});

export default projectManagementApp;
