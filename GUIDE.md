# NocoBase Application Builder

## How to Respond

| User says | Do this |
|-----------|---------|
| "Build me a XXX system" | **Build Mode** → design → confirm → scaffold → edit → deploy |
| "Modify / add a field" | Edit collections/*.yaml + templates/block/*.yaml → redeploy `--force` |
| "Export pages" | `npx tsx src/cli/cli.ts export-project "Group" outdir/` |

## Build Mode — 分层搭建

分三轮，每轮部署确认后再继续。

### 第一轮：页面布局

所有页面的基本布局，包括 CRUD 列表页和仪表盘。

1. **设计** — 列出数据表、字段、关系，确认后开始
2. **Scaffold** — 生成骨架（Dashboard + CRUD 页面）
3. **编辑** — `collections/*.yaml` 加业务字段，`templates/block/*.yaml` 更新布局，Dashboard 加 KPI/图表区块
4. **部署** — deploy-project，确认所有页面布局正确

```bash
# Scaffold（--collections 自动推导页面名 + Dashboard）
npx tsx src/cli/cli.ts scaffold /tmp/my-app MyApp \
  --collections nb_myapp_orders,nb_myapp_customers,nb_myapp_products

# Deploy
cd src && NB_USER=admin@nocobase.com NB_PASSWORD=admin123 \
  npx tsx cli/cli.ts deploy-project /tmp/my-app --group "My App" --force
```

Scaffold 生成内容：
- Dashboard：KPI 卡片（JS 区块）+ 图表（chart 区块）
- 每个数据表：filterForm（含 stats 筛选按钮）+ table + addNew/edit 弹窗

### 第二轮：详情页

点击记录名打开的弹窗 = 详情页面。默认只有一个 details 区块，需要按业务需求丰富：

- **详情区块**：主要字段 + 分组布局（field_layout）
- **关联列表**：o2m/m2m 关联数据表格（如订单→明细、客户→联系人）
- **Tabs 分页**：内容多时用 tabs 分隔不同类别
- **操作按钮**：详情页内的业务操作（审批、状态变更等）

编辑 `templates/popup/detail_xxx.yaml` 和弹窗模板中的 blocks 内容。

### 第三轮：JS 区块 + 事件流

填充业务逻辑：

**JS 区块** — 从 `templates/js/` 复制组件模板，修改 CONFIG 参数：

| 模板 | 类型 | 用途 |
|------|------|------|
| `stats-filter.js` | JSItemModel | 状态分布筛选按钮（ctx.sql 动态查询） |
| `kpi-card.js` | JSBlockModel | KPI 指标卡片 |
| `status-tag.js` | JSColumnModel | 彩色状态标签 |
| `progress-bar.js` | JSColumnModel | 进度条列 |
| `currency.js` | JSColumnModel | 货币格式化列 |

**事件流（Workflow）** — 业务自动化：
- 状态变更触发通知
- 库存不足自动创建采购单
- 审批流程

## What Scaffold Generates

```
/tmp/my-app/
├── routes.yaml              # Menu structure
├── defaults.yaml            # Auto-binds popup templates to m2o fields
├── collections/*.yaml       # Table definitions (edit these: add fields)
├── templates/
│   ├── block/               # Form/detail content (edit these: field_layout)
│   │   ├── form_add_new_xxx.yaml
│   │   ├── form_edit_xxx.yaml
│   │   └── detail_xxx.yaml
│   └── popup/               # Whole-drawer templates (don't edit)
│       ├── add_new_xxx.yaml
│       ├── edit_xxx.yaml
│       └── detail_xxx.yaml
├── pages/<mod>/<page>/
│   ├── layout.yaml          # Page layout (filterForm + table)
│   ├── js/stats_filter.js   # Stats button group stub
│   └── popups/              # Popup refs (don't edit)
└── state.yaml               # Deploy state (auto-managed)
```

> **Only edit**: `collections/*.yaml` (fields) + `templates/block/*.yaml` (form layout)
> Everything else is auto-generated and auto-wired.

## Collection Template

```yaml
name: nb_myapp_orders
title: Orders
fields:
  - name: name
    interface: input
    title: Name
  - name: status
    interface: select
    title: Status
    uiSchema:
      enum:
        - { label: Draft, value: draft }
        - { label: Active, value: active }
        - { label: Done, value: done }
  - name: customer
    interface: m2o
    title: Customer
    target: nb_myapp_customers
  - name: total
    interface: number
    title: Total Amount
  - name: due_date
    interface: dateOnly
    title: Due Date
```

> titleField auto-set to `name` or `title`. FK fields auto-created for m2o.

## Block Template (form/detail layout)

```yaml
# templates/block/form_add_new_nb_myapp_orders.yaml
name: 'Form (Add new): Orders'
type: block
collectionName: nb_myapp_orders
content:
  key: createForm
  type: createForm
  coll: nb_myapp_orders
  fields: [name, status, customer, total, due_date, description]
  field_layout:
    - '--- Basic Info ---'
    - [name, status]
    - [customer, due_date]
    - '--- Financial ---'
    - [total]
    - [description]
  actions:
    - submit
```

> edit + detail templates use the **same field_layout**. Edit all 3 together.

## Page Layout Template

```yaml
# pages/myapp/orders/layout.yaml
blocks:
  - key: filterForm
    type: filterForm
    coll: nb_myapp_orders
    fields:
      - field: name
        label: Search
        filterPaths: [name, description]
      - status
    js_items:
      - desc: Stats Filter Block
        file: ./js/stats_filter.js
    field_layout:
      - ['[JS:Stats Filter Block]']
      - [name, status]
  - key: table
    type: table
    coll: nb_myapp_orders
    fields:
      - field: name
        popup: templates/popup/detail_nb_myapp_orders.yaml
      - customer
      - status
      - total
      - due_date
      - createdAt
    actions: [filter, refresh, addNew]
    recordActions:
      - edit
      - updateRecord:
          key: mark_done
          icon: checkoutlined
          tooltip: Done
          assign: { status: done }
          hiddenWhen: { status: done }
layout:
  - [filterForm]
  - [table]
```

## Key Rules

1. **Design first** — never build without user confirmation
2. **Scaffold first** — always start with `scaffold`, then edit generated files
3. **filterForm** — max 2-3 fields + must have js_items stats block on first row
4. **No manual actions on filterForm** — NocoBase auto-creates submit/reset
5. **No `view` in recordActions** — name field clickToOpen already provides detail view
6. **Edit 3 block templates together** — addNew, edit, detail share same field_layout baseline
7. **m2o fields auto-popup** — defaults.yaml binds popup templates, no manual config needed
8. **Incremental** — always `--force` update, never destroy + recreate
9. **Layout required** — >2 blocks need `layout:`, >2 form fields need `field_layout:`

## Field Types

| interface | Use for | Example |
|-----------|---------|---------|
| `input` | Short text | name, code, title |
| `textarea` | Long text | description, notes |
| `select` | Dropdown | status, priority, role |
| `number` | Numbers | amount, quantity, rate |
| `percent` | Percentage | progress, discount |
| `dateOnly` | Date | start_date, due_date |
| `date` | Date+time | created_at |
| `m2o` | Relation (many-to-one) | project, assignee, customer |
| `email` | Email | email |
| `checkbox` | Boolean | is_active |

## Commands

```bash
cd /path/to/nocobase-reconciler

# Scaffold
npx tsx src/cli/cli.ts scaffold /tmp/app AppName \
  --pages Page1,Page2 --collections nb_app_coll1,nb_app_coll2

# Deploy (first time)
cd src && NB_USER=admin@nocobase.com NB_PASSWORD=admin123 \
  npx tsx cli/cli.ts deploy-project /tmp/app --group "App Name" --blueprint

# Redeploy (after edits)
npx tsx cli/cli.ts deploy-project /tmp/app --group "App Name" --force

# Export
npx tsx cli/cli.ts export-project "App Name" /tmp/export
```
