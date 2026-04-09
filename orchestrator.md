# Reconciler Workflow — AI Collaboration Guide

## Overview

User and AI collaborate through interactive conversation to build the system. AI decides on its own whether to launch sub-agents for parallel processing.

## Core Workflow

### 1. Requirements Understanding
User describes business scenario → AI designs data model + page structure

### 2. Write Spec
AI writes `structure.yaml` (tables + pages) + `enhance.yaml` (popups + JS placeholders)

### 3. Deploy Skeleton
```bash
python deployer.py <module>/
```

### 4. JS Implementation (parallelizable)
JS files are independent of each other → AI can launch multiple sub-agents to write JS in parallel:
- Each sub-agent handles only one JS file
- Only needs: requirement description + collection fields + ctx API
- Does not need to know about UIDs, layout, or deployer

### 5. Inject JS
```bash
python deployer.py <module>/ --force
```

### 6. Verify + Iterate
User reviews the result → feedback → AI modifies spec or JS → incremental deploy

## JS Sub-Agent Context

Sub-agents only need the following information when implementing JS:

```
Technical environment:
- ctx.record: current row/record data
- ctx.React: React hooks (useState, useEffect, etc.)
- ctx.antd: Ant Design components (Tag, Card, Row, Col, Statistic, Badge, Progress, etc.)
- ctx.api.request({url, params}): API calls
- ctx.render(<JSX />): render output
- ctx.engine.getModel(uid): cross-block interaction

JS types:
- JSColumnModel: custom table column — ctx.record has current row
- JSItemModel: JS inside detail/form — ctx.record has current record
- JSBlockModel: standalone JS block — must fetch its own data
```

## Reference Templates
- `exports/crm-v2/` — full CRM export (7 pages + popups + 30 JS)
- `python view.py exports/crm-v2/ --popups` — visualize structure
