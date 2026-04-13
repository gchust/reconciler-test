# NocoBase DSL Reconciler

TypeScript "NocoBase as Code" engine — bidirectional sync between YAML/JS spec files and live NocoBase systems.

## Project Structure

```
src/
├── client/           # NocoBase API client (flowSurfaces, collections, routes, models)
├── deploy/           # Deploy: DSL → NocoBase
│   ├── project-deployer.ts   # Main orchestrator (discoverPages → blueprint → deploySurface → popups)
│   ├── blueprint-converter.ts # DSL → applyBlueprint document format
│   ├── surface-deployer.ts   # Block compose + sync + layout
│   ├── block-filler.ts       # Fill block content (JS, charts, actions, templateRef, clickToOpen)
│   ├── popup-deployer.ts     # Popup deployment (tabbed, nested)
│   ├── collection-deployer.ts # collections:apply (upsert)
│   └── fillers/              # Sub-modules (action, chart, js, divider, field-layout, click-to-open)
├── export/           # Export: NocoBase → DSL
│   ├── project-exporter.ts   # Full project export
│   └── block-exporter.ts     # Block → YAML conversion
├── acl/              # ACL export/deploy (roles, scopes, permissions)
├── workflow/         # Workflow export/deploy
├── utils/
│   ├── filter-validator.ts   # Shared filter validation (ACL scopes, dataScope, linkage)
│   └── js-utils.ts           # JS code header/desc extraction
├── types/            # TypeScript types (spec.ts = DSL, state.ts = UIDs, api.ts = API responses)
└── cli/cli.ts        # CLI entry point
```

## Key Commands

```bash
cd src

# Deploy (blueprint mode — one API call per page)
npx tsx cli/cli.ts deploy-project <dir> --group "CRM Copy" --blueprint

# Deploy (legacy mode — compose + fillBlock multi-step)
npx tsx cli/cli.ts deploy-project <dir> --group "CRM Copy"

# Export
npx tsx cli/cli.ts export-project <dir> --group "Main"

# ACL
npx tsx cli/cli.ts export-acl <dir>
npx tsx cli/cli.ts deploy-acl <dir> --dry-run

# TypeScript check
npx tsc --noEmit
```

## Environment

```bash
export NB_USER=admin@nocobase.com NB_PASSWORD=admin123 NB_URL=http://localhost:14000
```

## CRM Roundtrip Test

See `/tmp/crm-roundtrip/README.md` for the full deploy → export → diff verification workflow.

## Architecture Notes

### Blueprint vs Legacy Deploy
- **Blueprint** (`--blueprint`): `flowSurfaces:applyBlueprint` — one API call creates entire page (navigation + blocks + fields + actions + layout + JS/charts). Then `deploySurface` runs in sync mode to polish (clean auto-created actions, add non-standard actions, linkage rules).
- **Legacy**: Multi-step: `compose` → `fillBlock` → `setLayout` → `addAction` etc.
- Blueprint automatically falls back to legacy if it fails (e.g. unsupported block types).

### Key APIs
- `flowSurfaces:applyBlueprint` — whole-page deploy
- `flowSurfaces:compose` — create block shells
- `flowSurfaces:addAction` / `addRecordAction` — add buttons (details blocks use addRecordAction, not addAction)
- `collections:apply` — upsert collection + fields
- `flowSurfaces:setFieldLinkageRules` / `setBlockLinkageRules` / `setActionLinkageRules` — linkage rules

### Filter Validation
`src/utils/filter-validator.ts` — shared across ACL scopes, dataScope, linkage rules:
- Field existence (L1 + L2 relation chain)
- Relation field misuse (`createdBy: true` → error, suggest `createdById`)
- Operator validity per field type
- Context: ACL allows `{{$user.id}}` variables, dataScope forbids them

### Pitfalls (see src/PITFALLS.md)
- `flowModels:update` clears parentId → NEVER call directly, use `updateModel()`
- `desktopRoutes:update` must use `{ params: { 'filter[id]': id } }` not URL string
- `desktopRoutes:set` for ACL routes: send flat array `[id1, id2]`, not `{values: [...]}`
- Details/List/GridCard are "record action containers" → use `addRecordAction`, not `addAction`

## CRM Roundtrip Test

See `/tmp/crm-roundtrip/README.md` for deploy → export → diff commands.
