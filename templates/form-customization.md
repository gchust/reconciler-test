# Form Customization Patterns

Three patterns for customizing NocoBase forms, from simple to complex.

## Pattern A: JS Item in Form — Interactive Widgets

A JS component embedded inside a form for user-triggered actions (search, calculate, preview).

**When to use**: Complex selection UI, remote search with custom rendering, multi-step workflows inside a form.

**Spec format** (in enhance.yaml or popups/*.yaml):
```yaml
blocks:
  - key: form
    type: createForm
    fields: [name, status, ...]
    js_items:
      - desc: Site Search Panel — search by site/branch/unit, auto-fill subtable
        file: ./js/form_site_search.js
    field_layout:
      - ["[JS:Site Search Panel]"]     # JS widget on top
      - "--- Basic Info ---"
      - [name, status]
```

**Key APIs**:
```javascript
// Read form values
var values = ctx.form?.values || {};

// Write form values (single call, atomic)
ctx.form?.setFieldsValue({
  field1: value1,
  subtable: [{ col1: val, col2: val }, ...]
});

// Remote search
ctx.request({
  url: 'collection:list',
  params: { filter: JSON.stringify({...}), pageSize: 20 }
});
```

## Pattern B: Event Flows — Auto-Calculation on Field Change

JS code that runs when a form field value changes. For auto-fill, computation, validation.

**When to use**: Auto-calculate totals, distribute amounts, copy values between fields.

**Spec format**:
```yaml
blocks:
  - key: form
    type: createForm
    event_flows:
      - event: formValuesChange
        desc: Auto-distribute total amount across subtable rows equally
        file: ./js/event_calc_share.js
```

**Key APIs**:
```javascript
// Event flow context — runs on every field change
var values = ctx.form?.values || {};
var items = values.subtable_field || [];
var total = parseFloat(values.total_amount) || 0;

// Guard: exit early if nothing to do
if (!items.length || !total) return;

// Calculate
var share = Math.round(total / items.length * 100) / 100;
var last = Math.round((total - share * (items.length - 1)) * 100) / 100;

// Update entire subtable at once
var updated = items.map(function(item, i) {
  return Object.assign({}, item, { share_amount: i === items.length - 1 ? last : share });
});
ctx.form?.setFieldsValue({ subtable_field: updated });
```

**Storage**: `stepParams.eventSettings.eventFlows` on the FormBlockModel
```json
{
  "eventSettings": {
    "eventFlows": {
      "formValuesChange": {
        "code": "var values = ctx.form?.values || {}; ..."
      }
    }
  }
}
```

## Pattern C: Linkage Rules — Conditional Field Visibility

Declarative rules to show/hide/enable/disable fields based on other field values.

**When to use**: Toggle field visibility based on type/status selection, conditional required fields.

**Spec format**:
```yaml
blocks:
  - key: form
    type: createForm
    linkage_rules:
      - condition: { field: payment_method, op: $eq, value: by_branch }
        actions:
          - { target: branch_selector, visible: true, required: true }
          - { target: site_selector, visible: false }
```

**Storage**: `stepParams.eventSettings.linkageRules` on the FormBlockModel

## Implementation Priority

1. **JS Items in forms** — Already supported ✅
2. **Event Flows** — Next to implement (deployer reads `event_flows` from spec, sets on FormBlockModel)
3. **Linkage Rules** — After event flows (deployer reads `linkage_rules`, sets on FormBlockModel)

## SES Sandbox Constraints

NocoBase JS runs in a Secure ECMAScript sandbox. Restrictions:
- Use `var` (not `const`/`let`)
- Use `function(){}` (not `=>`)
- Use string concatenation (not template literals)
- Use `Object.assign()` (not spread `...`)
- Get React from `ctx.React`, antd from `ctx.antd`
- `filter` parameter MUST be `JSON.stringify()` (not object)

## File Organization

```
module/
├── enhance.yaml              # addNew forms with event_flows
├── popups/
│   └── projects-detail.yaml  # detail popup (may also have JS items)
├── js/
│   ├── form_site_search.js   # Pattern A: JS item widget
│   ├── event_calc_share.js   # Pattern B: event flow handler
│   └── ...
```
