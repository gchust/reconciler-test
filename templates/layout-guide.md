# Detail Popup Layout Guide

## Core Principles

- **The overview tab gives the full picture** — 80% of the information should be visible without switching tabs
- **Layered associated data** — overview shows compact version (latest 5 records), dedicated tabs show the full version
- **Left-primary, right-secondary** — left 16 grid units for core fields, right 8 grid units for auxiliary info and quick glances

## Tab Structure

```
Tab 0: Overview (required)
  Left 16:
    [JS: KPI Card]              ← Key metrics at a glance
    --- Section Title ---
    [Field row, 3 columns]
    [Field row, 2 columns]
    ...
  Right 8:
    --- Auxiliary Info ---       ← Card-style fields (pricing/financials, etc.)
    [Fields]
    --- Recent xxx ---          ← Compact related table (5 rows)
    [Related table pageSize=5]

Tab 1-N: Related Data (as needed)
  [Full-width table]            ← Complete data with pagination and search

Last Tab: History
  [RecordHistory]
```

## What Goes in Overview vs. Dedicated Tab

| Overview (right side) | Dedicated Tab |
|----------------------|---------------|
| Latest 3-5 related records | Full related data (>10 records) |
| 3-4 column compact table | 5+ column detailed table |
| No search/filtering needed | Needs pagination/sorting/filtering |
| Auxiliary info cards (pricing/financials) | — |

## Example: Material Management

```yaml
tabs:
  - title: 概览                    # "Overview"
    blocks:
      - key: detail_main           # Left 16
        type: details
        fields: [编码, 名称, 分类, 规格, 单位, 状态, 库存, 安全库存, ...]
              # [code, name, category, spec, unit, status, stock, safety_stock, ...]
        js_items: [KPI 卡片]       # KPI Card
        field_layout:
          - "--- 基本信息 ---"      # "Basic Info"
          - [编码, 名称, 分类]      # [code, name, category]
          - [规格, 单位, 状态]      # [spec, unit, status]
          - "--- 库存 ---"          # "Inventory"
          - [库存量, 安全库存, 最大库存]  # [stock_qty, safety_stock, max_stock]
        recordActions: [edit]

      - key: detail_price           # Right 8 (card-style)
        type: details
        fields: [标准价, 成本价, 备注]  # [list_price, cost_price, notes]

      - key: recent_inv             # Right 8 (compact table)
        type: table
        title: 最近入出库             # "Recent In/Out"
        coll: inventory
        resource_binding: { associationName: ... }
        fields: [类型, 数量, 仓库, 日期]  # [type, qty, warehouse, date] — 4 columns is enough
        # pageSize: 5

    layout:
      - [{col: [detail_main], size: 16},
         {col: [detail_price, recent_inv], size: 8}]

  - title: 库存流水                 # "Inventory Transactions" — full table
    blocks:
      - type: table
        fields: [类型, 数量, 仓库, 单号, 操作人, 日期]  # [type, qty, warehouse, doc_no, operator, date] — 6 columns

  - title: 质检记录                 # "QC Records"
  - title: 历史记录                 # "History"
```

## Right-Side Card-Style Detail

For **a small number of high-value fields** (3-5), no divider needed, compact display:

```yaml
- key: detail_price
  type: details
  fields: [标准价, 成本价, 备注]      # [list_price, cost_price, notes]
  field_layout:
    - "--- 价格 ---"                  # "Pricing"
    - [标准价, 成本价]                 # [list_price, cost_price]
    - "--- 备注 ---"                  # "Notes"
    - [备注]                          # [notes]
```

## Compact Related Table

For **quickly glancing at recent records**:

```yaml
- key: recent_orders
  type: table
  title: 最近订单                     # "Recent Orders"
  coll: orders
  resource_binding:
    associationName: collection.orders
    sourceId: "{{ctx.view.inputArgs.filterByTk}}"
  fields: [单号, 金额, 状态]          # [order_no, amount, status] — 3-4 columns
  # pageSize: 5, no action buttons needed
```
