# JS Block Templates

Reusable JS code templates. After copying a file, AI only needs to modify the `CONFIG` section — shared logic stays untouched.

## Usage

1. Copy the template file to the module's `js/` directory
2. AI modifies the CONFIG section marked with `=== AI Modification Guide ===`
3. The deployer automatically replaces `__TABLE_UID__` during injection

## Template List

### kpi-card.js — KPI Card (SQL Version)

Full-width gradient card displaying a large number + period-over-period trend.

**AI only needs to change**:
```js
const CONFIG = {
  title: '本月销售额',              // Title (e.g. "Monthly Sales")
  gradient: ['#1677ff', '#4096ff'], // Gradient colors
  textColor: '#fff',                // Text color
  prefix: '¥',                      // Prefix
};
const SQL = `SELECT ... as current_value, ... as previous_value FROM ...`;
const parseResult = (row) => ({ value: ..., previous: ... });
```

**Color reference**:
- Sales / Revenue: blue `['#1677ff', '#4096ff']`
- Procurement / Expenses: orange `['#fa8c16', '#ffc53d']`, textColor: `'#333'`
- Production / Output: green `['#52c41a', '#95de64']`
- Quality Control: purple `['#722ed1', '#b37feb']`
- Inventory / Materials: cyan `['#13c2c2', '#5cdbd3']`

### filter-stats.js — Filter Statistics Button Group

Button group + count badges, click to filter the table. Supports multiple groups (separated by Divider).

**AI only needs to change**:
```js
const COLLECTION = 'your_collection';
const GROUPS = [
  { name: '状态', items: [                                          // "Status"
    { key: 'all', label: '全部', filter: null },                    // "All"
    { key: 'active', label: '有效', filter: { status: { $eq: '有效' } } },  // "Active"
  ]},
];
```

**Handled automatically**:
- `__TABLE_UID__` is replaced with the same-page table UID
- Counts are fetched in parallel via API
- Click triggers linked table filtering
