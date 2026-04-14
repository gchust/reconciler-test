# NocoBase Reconciler — AI 搭建指南

## 快速开始

### 1. 创建项目结构

```bash
mkdir -p /tmp/my-app/{collections,pages/my_app,templates}
```

```
/tmp/my-app/
├── routes.yaml           # 菜单结构（入口）
├── defaults.yaml          # 全局默认（popup/form 模板绑定）
├── collections/           # 数据表定义
│   ├── nb_xxx_orders.yaml
│   └── nb_xxx_products.yaml
├── templates/             # 可复用模板（popup/block）
│   ├── popup/
│   └── block/
├── pages/                 # 页面定义
│   └── my_app/
│       ├── orders/
│       │   ├── layout.yaml
│       │   └── popups/
│       └── products/
│           ├── layout.yaml
│           └── popups/
└── state.yaml             # 部署状态（自动生成，不要手动编辑）
```

### 2. 定义菜单 routes.yaml

```yaml
- title: My App
  type: group
  icon: appstoreoutlined
  children:
    - title: Orders
      icon: shoppingcartoutlined
    - title: Products
      icon: appstoreoutlined
```

> `type: flowPage` 是默认值，可以省略。只有子组需要写 `type: group`。

### 3. 定义数据表 collections/

```yaml
# collections/nb_xxx_orders.yaml
name: nb_xxx_orders
title: Orders
fields:
  - name: order_no
    interface: input
    title: Order No
  - name: customer
    interface: m2o
    title: Customer
    target: nb_xxx_customers
  - name: total_amount
    interface: number
    title: Total Amount
  - name: status
    interface: select
    title: Status
    uiSchema:
      enum:
        - { label: Draft, value: draft }
        - { label: Confirmed, value: confirmed }
        - { label: Shipped, value: shipped }
```

### 4. 定义页面 pages/

```yaml
# pages/my_app/orders/layout.yaml
blocks:
  - key: filterForm
    type: filterForm
    coll: nb_xxx_orders
    fields:
      - field: order_no
        label: Search
        filterPaths: [order_no, customer.name]
      - status
  - key: table
    type: table
    coll: nb_xxx_orders
    filter:                              # 简写语法
      status.$ne: cancelled
    fields:
      - field: order_no
        popup: true                      # 点击弹出详情
      - customer                         # 关联字段，defaults 自动绑 popup
      - total_amount
      - status
    actions:
      - filter
      - refresh
      - addNew
    recordActions:
      - view
      - edit
layout:
  - - filterForm
  - - table
```

### 5. 定义弹窗 popups/

```yaml
# pages/my_app/orders/popups/table.addNew.yaml
target: $SELF.table.actions.addNew
mode: drawer
blocks:
  - key: createForm
    type: createForm
    coll: nb_xxx_orders
    fields:
      - order_no
      - customer
      - total_amount
      - status
    field_layout:
      - '--- Basic Info ---'
      - - order_no
        - customer
      - - total_amount
        - status
    actions:
      - submit
```

### 6. 部署

```bash
export NB_USER=admin@nocobase.com NB_PASSWORD=admin123 NB_URL=http://localhost:14000
npx tsx src/cli/cli.ts deploy-project /tmp/my-app --group "My App" --blueprint
```

---

## YAML Sugar 语法速查

### 区块简写

```yaml
# JS 区块
- js: ./js/dashboard.js
- js: { file: ./js/calendar.js, desc: Activity Calendar }

# 模板引用
- ref: templates/block/form_orders.yaml
```

### 字段简写

```yaml
fields:
  - order_no                              # 纯字符串 = 普通字段
  - field: name
    popup: true                           # 默认弹窗（drawer + large）
  - field: name
    popup: templates/popup/order_view.yaml  # 引用 popup 模板
  - field: amount
    width: 100                            # 列宽
```

### Action 简写

```yaml
actions:
  - filter                                # 纯字符串
  - refresh
  - addNew
  - link: { title: View All, icon: arrowrightoutlined, url: /admin/xxx }
  - ai: viz                               # AI 员工
  - ai: { employee: dex, tasks: ./ai/tasks.yaml }

recordActions:
  - view
  - edit
  - delete
  - updateRecord:                         # 行内更新
      key: mark_done
      icon: checkoutlined
      tooltip: Done
      assign:
        status: done
      hiddenWhen:                         # 条件隐藏
        status: done
```

### 筛选简写

```yaml
# Sugar（推荐）
filter:
  status.$in: [new, working]
  score.$gte: 75

# 完整格式（也支持）
dataScope:
  logic: $and
  items:
    - path: status
      operator: $in
      value: [new, working]
```

### 布局

```yaml
layout:
  - - filterForm                          # 第1行：全宽
  - - sidebar: 5                          # 第2行：两列 5:19
    - table: 19
  - - chart1: 12                          # 第3行：两列 12:12
    - chart2: 12
```

### 表单字段布局

```yaml
field_layout:
  - '--- Section Title ---'              # 分组标题
  - - name                                # 单列
  - - field1                              # 两列并排
    - field2
  - - col:                                # 堆叠列
      - field3
      - field4
    size: 8
```

---

## 高级功能

### 全局默认 defaults.yaml

```yaml
popups:
  nb_xxx_orders: templates/popup/order_view.yaml      # 任何 order 关联字段自动弹这个
  nb_xxx_customers: templates/popup/customer_view.yaml
forms:
  nb_xxx_orders: templates/block/form_orders.yaml      # 所有 order 新建表单用这个模板
```

### 事件流（表单自动计算）

当表单值变化时自动计算：

```yaml
# 在 block spec 里声明
event_flows:
  - event:
      eventName: formValuesChange
    file: ./events/calc_total.js
```

```javascript
// events/calc_total.js
// 触发条件：表单任意字段变化
(async () => {
  const values = ctx.form?.values || {};
  const quantity = parseFloat(values.quantity) || 0;
  const price = parseFloat(values.unit_price) || 0;
  const total = quantity * price;

  // 设置字段值
  ctx.form.setFieldState('total_amount', state => {
    state.value = total;
  });
})();
```

### 联动规则（字段显隐/必填）

联动规则在 NocoBase UI 中配置，导出时自动保存在 YAML 中。
部署时自动还原。**不需要手写**——在 UI 中设置后导出即可。

如需在 YAML 中查看/调试已有联动规则：
```yaml
# 导出后会出现在 block spec 里
fieldLinkageRules:
  - title: Hide fields when status is draft
    condition:
      logic: $and
      items:
        - path: status
          operator: $eq
          value: draft
    actions:
      - name: linkageSetFieldProps
        params:
          value:
            fields: [approved_by, approved_at]
            state: hidden
```

### Popup 模板

在 `templates/popup/` 目录定义可复用弹窗：

```yaml
# templates/popup/order_view.yaml
name: Order View
type: popup
collectionName: nb_xxx_orders
content:
  tabs:
    - title: Details
      blocks:
        - key: details
          type: details
          coll: nb_xxx_orders
          fields: [order_no, customer, total_amount, status]
      layout:
        - - details
    - title: Items
      blocks:
        - key: items
          type: table
          coll: nb_xxx_order_items
          resource_binding:
            associationName: nb_xxx_orders.items
            sourceId: '{{ctx.view.inputArgs.filterByTk}}'
```

### Block 模板（表单模板）

```yaml
# templates/block/form_orders.yaml
name: 'Form (Add new): Orders'
type: block
collectionName: nb_xxx_orders
content:
  key: createForm
  type: createForm
  coll: nb_xxx_orders
  fields: [order_no, customer, total_amount, status]
  field_layout:
    - '--- Order Info ---'
    - - order_no
      - customer
    - - total_amount
      - status
  actions:
    - submit
```

---

## 搭建步骤（推荐顺序）

1. **定义数据表** → `collections/` 目录
2. **定义菜单** → `routes.yaml`
3. **写页面** → `pages/` 每个页面一个 `layout.yaml`
4. **写弹窗** → `popups/` 目录（addNew、详情、编辑）
5. **部署** → `deploy-project` 命令
6. **在 UI 微调** → 联动规则、权限等
7. **导出** → `export-project` 保存为 DSL 快照
8. **复制改名** → 创建新模块

## 常用命令

```bash
# 部署
npx tsx src/cli/cli.ts deploy-project /path/to/project --group "Group Name" --blueprint

# 导出
npx tsx src/cli/cli.ts export-project /path/to/project --group "Group Name"

# 工作流校验
npx tsx src/cli/cli.ts validate-workflows /path/to/project
```
