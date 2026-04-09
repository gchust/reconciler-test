# NocoBase JS Block Development Guide

## Runtime Environment

All components are injected via `ctx` — **no imports needed**:

```js
ctx.React       // React (useState, useEffect, useRef, useCallback, useMemo)
ctx.antd        // Ant Design 5.x full component library
ctx.render()    // Render output (call only once at the outermost level)
ctx.record      // Current row/record data (JSColumn/JSItem)
ctx.api         // API calls: ctx.api.request({url, params})
ctx.engine      // Cross-block linking: ctx.engine.getModel(uid)
ctx.model       // Current block model
ctx.libs.dayjs  // Date library
```

## Three JS Types

| Type | Location | Data Source | Use Case |
|------|----------|------------|----------|
| JSColumnModel | Custom table column | `ctx.record` = current row | Status tags, progress bars, computed values |
| JSItemModel | Inside detail/form/filter | `ctx.record` = current record | KPI cards, stats buttons, custom display |
| JSBlockModel | Standalone block | `ctx.api.request()` to fetch | Dashboards, kanban boards, charts |

## Key Rules

### 1. Call ctx.render only once at the outermost level

```js
// ✅ Correct
const MyComponent = () => {
  return (<Tag color="green">OK</Tag>);  // Return JSX directly inside component
};
ctx.render(<MyComponent />);              // Call once at outermost level

// ❌ Wrong
const MyComponent = () => {
  return ctx.render(<Tag>OK</Tag>);       // Do not call ctx.render inside component
};
ctx.render(<MyComponent />);
```

### 2. Do not call function components directly

```js
// ✅ Correct
ctx.render(<StatsFilter />);

// ❌ Wrong
StatsFilter();    // Violates React hooks rules
```

### 3. Cross-block linking (filter buttons)

```js
const TARGET_BLOCK_UID = '__TABLE_UID__';  // Automatically replaced by deployer

const target = ctx.engine?.getModel(TARGET_BLOCK_UID);
if (target) {
  target.resource.addFilterGroup(ctx.model.uid, { status: { $eq: '有效' } });
  await target.resource.refresh();
}
```

### 4. API Calls

```js
const res = await ctx.api.request({
  url: 'collection_name:list',
  params: { pageSize: 1, filter: { status: { $eq: '有效' } } },
});
const count = res?.data?.meta?.count || 0;
```

### 5. Using Ant Design Components

```js
const { Tag, Card, Row, Col, Statistic, Badge, Space, Progress,
        Steps, Rate, Divider, Typography, Spin, Button } = ctx.antd;
```

## File Header Comment Template

```js
/**
 * {desc}
 *
 * @type {JSColumnModel|JSItemModel|JSBlockModel}
 * @collection {collection_name}
 * @fields {field1}, {field2}, ...
 */
```

## Styling Guidelines

- Use antd built-in components and tokens — no custom CSS
- Tag colors: red = danger, orange = warning, green = normal, blue = info, gray = disabled
- Statistic for numeric display, with prefix/suffix
- Card size="small" + marginBottom: 16 for KPI cards
- Space wrap size={[8, 8]} for button groups
- Badge + Button for stats filter buttons

## Chart (ECharts) Guide

### Data Access

```js
// Data access inside chart option.raw
const data = ctx.data?.objects || [];  // ✅ Correct: SQL results are in .objects
// const data = ctx.data || [];        // ❌ Wrong: ctx.data is an object, not an array
```

### Chart Configuration Structure

```json
{
  "query": { "mode": "sql", "sql": "SELECT ..." },
  "chart": {
    "option": {
      "mode": "custom",
      "raw": "const data = ctx.data?.objects || []; return { ... ECharts option ... };"
    }
  }
}
```

### ctx.data.objects Format

```js
// SQL: SELECT status, COUNT(*) as cnt FROM table GROUP BY status
// ctx.data.objects = [
//   { status: '有效', cnt: 5 },      // "Active"
//   { status: '停用', cnt: 2 },      // "Disabled"
// ]
```
