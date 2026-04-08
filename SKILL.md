# NocoBase Reconciler — AI Skill Reference

> 这个文件是给 AI agent 看的参考。概述了模块部署的能力和用法。

## 工作流程

```
structure.yaml (AI 编辑) → deploy → state.yaml (UID 注册表) → enhance.yaml (AI 编辑) → deploy
```

### Layer 1: 页面骨架 (structure.yaml)

AI 生成这个文件，描述"要什么"，不关心模型名：

```yaml
module: 库存管理
icon: shoppingoutlined

collections:
  inv_products:
    title: 产品
    fields:
      - { name: sku, interface: input, title: SKU }
      - { name: status, interface: select, title: 状态, options: [正常, 缺货] }

pages:
  - page: 产品管理
    coll: inv_products
    blocks:
      - key: filter
        type: filterForm
        fields: [product_name, category, status]

      - key: table
        type: table
        fields: [sku, product_name, category, price, status]
        actions: [filter, refresh, addNew, export]
        recordActions: [edit, view, delete]
```

### Layer 2: 增强 (enhance.yaml)

引用 state.yaml 中的 UID，给弹窗填内容、加 JS：

```yaml
popups:
  - page: 产品管理
    target: table.actions.addNew        # 从 state.yaml 查到 popup_grid UID
    blocks:
      - key: form
        type: form
        coll: inv_products
        fields: [sku*, product_name*, category, price, status]

js:
  - uid: <from state.yaml>
    file: ./custom-column.js
```

## 区块类型 (type)

| type | 说明 | 用在哪 |
|------|------|-------|
| `table` | 数据表格 | 主页面 |
| `filterForm` | 筛选表单 | 主页面（自动连接同页面表格） |
| `form` | 新建表单 | 主页面或弹窗 |
| `editForm` | 编辑表单 | 弹窗 |
| `detail` | 详情展示 | 弹窗 |
| `list` | 列表 | 主页面或弹窗 |
| `gridCard` | 卡片网格 | 主页面 |
| `chart` | 图表 | 主页面 |
| `markdown` | Markdown | 主页面 |

## 操作按钮 (actions / recordActions)

### Table 区块的 actions（工具栏）
```
filter, refresh, addNew, export, import, bulkDelete, bulkUpdate, bulkEdit, link, expand, popup, js, ai
```

### Table 区块的 recordActions（行操作）
```
edit, view, delete, duplicate, addChild, update, customRequest, popup, js
```

### FilterForm 区块的 actions
```
collapse, submit, reset, js
```
> 通常不需要手动加 — 筛选表单自动监听。

### Form 区块的 actions
```
submit, js
```

### Detail 区块的 actions
```
edit, delete, duplicate, popup, js, ai
```

## 字段 DSL

structure.yaml 里的字段直接写 fieldPath（字段名），服务端自动推断类型：

```yaml
fields: [sku, product_name, category, price, status]
```

字段类型由 collection 的 interface 决定（input→文本, select→下拉, number→数字...），不需要在 structure.yaml 里指定。

## state.yaml — UID 注册表

deploy 后自动生成，**每个元素都有 UID**。L2 或手动操作时按路径查找：

```yaml
pages:
  产品管理:
    tab_uid: xxx                      # 页面 tab
    blocks:
      table:
        uid: aaa                      # 表格区块
        fields:
          sku: {wrapper: bbb, field: ccc}
          product_name: {wrapper: ddd, field: eee}
        actions:
          addNew: {uid: fff, popup_page: ggg, popup_grid: hhh}
        record_actions:
          edit: {uid: iii, popup_page: jjj, popup_grid: kkk}
```

**查 UID 路径示例**：
- 表格区块 UID → `pages.产品管理.blocks.table.uid`
- SKU 列的字段 UID → `pages.产品管理.blocks.table.fields.sku.field`
- 新建按钮的弹窗 grid → `pages.产品管理.blocks.table.actions.addNew.popup_grid`
- 编辑行按钮 UID → `pages.产品管理.blocks.table.record_actions.edit.uid`

## flowSurfaces API 快速参考

所有操作通过 `nb.py` 的 NocoBase 类调用：

| 方法 | 用途 | 何时用 |
|------|------|--------|
| `compose(tab_uid, blocks)` | 一次创建多个区块 | L1 部署 |
| `add_block(grid_uid, type)` | 增量加一个区块 | L2 弹窗内容 |
| `add_field(target_uid, path)` | 给区块加字段 | 补充字段 |
| `add_action(target_uid, type)` | 给区块加操作按钮 | 补充按钮 |
| `configure(uid, changes)` | 修改节点配置 | JS 代码、设置 |
| `set_layout(grid_uid, rows, sizes)` | 调整布局 | 筛选字段排布 |
| `set_event_flows(uid, flows)` | 设置事件流 | 联动逻辑 |
| `get(uid=...)` | 读取节点树 | 同步/检查 |
| `catalog(target_uid)` | 查询可用组件 | 了解能加什么 |
| `context(uid, path)` | 查询上下文 | 图表配置 |

## 命令

```bash
python deploy2.py <module_dir>/           # 部署模块
python deploy2.py <module_dir>/ --l1      # 只部署 L1
python deploy2.py <module_dir>/ --l2      # 只部署 L2
python deploy2.py <module_dir>/ --dry     # 计划预览
python sync2.py                           # 列出系统路由
python sync2.py "GroupName" <dir>/        # 导出模块
```
