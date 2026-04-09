# NocoBase JS Block 开发规范

## 运行环境

所有组件通过 `ctx` 注入，**不需要 import**：

```js
ctx.React       // React (useState, useEffect, useRef, useCallback, useMemo)
ctx.antd        // Ant Design 5.x 全量组件
ctx.render()    // 输出渲染（只在最外层调一次）
ctx.record      // 当前行/记录数据（JSColumn/JSItem）
ctx.api         // API 调用 ctx.api.request({url, params})
ctx.engine      // 跨区块联动 ctx.engine.getModel(uid)
ctx.model       // 当前区块 model
ctx.libs.dayjs  // 日期库
```

## 三种 JS 类型

| 类型 | 位置 | 数据来源 | 用途 |
|------|------|---------|------|
| JSColumnModel | 表格自定义列 | `ctx.record` = 当前行 | 状态标签、进度条、计算值 |
| JSItemModel | 详情/表单/筛选内 | `ctx.record` = 当前记录 | KPI卡片、统计按钮、自定义展示 |
| JSBlockModel | 独立区块 | `ctx.api.request()` 查 | 仪表盘、看板、图表 |

## 关键规则

### 1. ctx.render 只在最外层调一次

```js
// ✅ 正确
const MyComponent = () => {
  return (<Tag color="green">OK</Tag>);  // 组件内直接 return JSX
};
ctx.render(<MyComponent />);              // 最外层调一次

// ❌ 错误
const MyComponent = () => {
  return ctx.render(<Tag>OK</Tag>);       // 组件内不要调 ctx.render
};
ctx.render(<MyComponent />);
```

### 2. 不要直接调用函数组件

```js
// ✅ 正确
ctx.render(<StatsFilter />);

// ❌ 错误
StatsFilter();    // 违反 React hooks 规则
```

### 3. 跨区块联动（筛选按钮）

```js
const TARGET_BLOCK_UID = '__TABLE_UID__';  // deployer 自动替换

const target = ctx.engine?.getModel(TARGET_BLOCK_UID);
if (target) {
  target.resource.addFilterGroup(ctx.model.uid, { status: { $eq: '有效' } });
  await target.resource.refresh();
}
```

### 4. API 调用

```js
const res = await ctx.api.request({
  url: 'collection_name:list',
  params: { pageSize: 1, filter: { status: { $eq: '有效' } } },
});
const count = res?.data?.meta?.count || 0;
```

### 5. Ant Design 组件使用

```js
const { Tag, Card, Row, Col, Statistic, Badge, Space, Progress,
        Steps, Rate, Divider, Typography, Spin, Button } = ctx.antd;
```

## 文件头注释模板

```js
/**
 * {desc}
 *
 * @type {JSColumnModel|JSItemModel|JSBlockModel}
 * @collection {collection_name}
 * @fields {field1}, {field2}, ...
 */
```

## 样式规范

- 使用 antd 内置组件和 token，不写自定义 CSS
- Tag 颜色：red=危险, orange=警告, green=正常, blue=信息, gray=无效
- Statistic 用于数值展示，带 prefix/suffix
- Card size="small" + marginBottom: 16 用于 KPI 卡片
- Space wrap size={[8, 8]} 用于按钮组
- Badge + Button 用于统计筛选按钮

## Chart (ECharts) 规范

### 数据访问

```js
// Chart option.raw 里的数据访问
const data = ctx.data?.objects || [];  // ✅ 正确：SQL 结果在 objects 里
// const data = ctx.data || [];        // ❌ 错误：ctx.data 是对象不是数组
```

### Chart 配置结构

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

### ctx.data.objects 格式

```js
// SQL: SELECT status, COUNT(*) as cnt FROM table GROUP BY status
// ctx.data.objects = [
//   { status: '有效', cnt: 5 },
//   { status: '停用', cnt: 2 },
// ]
```
