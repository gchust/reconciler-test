"""Module deployer v2 — layered deployment via flowSurfaces API.

Layer 1 (structure.yaml): page skeleton — group + pages + top-level blocks
Layer 2 (enhance.yaml):   popup content + JS + event flows (references L1 UIDs)

Usage:
    python deploy2.py inventory/              # deploy all layers in order
    python deploy2.py inventory/ --l1         # deploy Layer 1 only
    python deploy2.py inventory/ --l2         # deploy Layer 2 only (requires L1 done)
    python deploy2.py inventory/ --dry        # validate + show plan
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import yaml

from nb import NocoBase, dump_yaml
from layout import parse_layout_spec, apply_layout, describe_layout


def deploy(module_dir: str, layers: list[str] = None, dry_run: bool = False):
    """Deploy a module from a directory containing structure.yaml + enhance.yaml."""
    mod = Path(module_dir)
    if not mod.is_dir():
        print(f"  Not a directory: {module_dir}")
        sys.exit(1)

    structure_file = mod / "structure.yaml"
    enhance_file = mod / "enhance.yaml"
    state_file = mod / "state.yaml"  # UIDs from L1, referenced by L2

    if not structure_file.exists():
        print(f"  Missing: {structure_file}")
        sys.exit(1)

    structure = yaml.safe_load(structure_file.read_text())
    state = yaml.safe_load(state_file.read_text()) if state_file.exists() else {}

    layers = layers or ["l1", "l2"]

    if dry_run:
        _show_plan(structure, enhance_file)
        return

    nb = NocoBase()
    print(f"  Connected to {nb.base}")

    if "l1" in layers:
        state = deploy_l1(nb, structure, state, mod)
        state_file.write_text(dump_yaml(state))
        print(f"\n  State saved to {state_file}")

    if "l2" in layers and enhance_file.exists():
        enhance = yaml.safe_load(enhance_file.read_text())
        if enhance:
            deploy_l2(nb, enhance, state, mod)

    print(f"\n  Done.")


# ══════════════════════════════════════════════════════════════════
#  Layer 1: Structure — group + pages + top-level blocks
# ══════════════════════════════════════════════════════════════════

def deploy_l1(nb: NocoBase, spec: dict, state: dict, mod: Path) -> dict:
    """Deploy Layer 1: collections, group, pages with blocks."""
    module_name = spec.get("module", "Untitled")
    icon = spec.get("icon", "appstoreoutlined")

    print(f"\n  ── Layer 1: {module_name} ──")

    # 1. Collections
    for coll_name, coll_def in spec.get("collections", {}).items():
        _ensure_collection(nb, coll_name, coll_def)

    # 2. Group
    group_id = state.get("group_id")
    if not group_id:
        group_id = _find_group(nb, module_name)
    if not group_id:
        result = nb.create_group(module_name, icon=icon)
        group_id = result["routeId"]
        print(f"  + group: {module_name} (id={group_id})")
    else:
        print(f"  = group: {module_name} (id={group_id})")

    state["group_id"] = group_id
    state.setdefault("pages", {})

    # 3. Pages
    for ps in spec.get("pages", []):
        page_title = ps["page"]
        page_key = _slugify(page_title)
        page_state = state["pages"].get(page_key, {})

        # Create page if needed
        if not page_state.get("tab_uid"):
            result = nb.create_page(page_title, group_id,
                                    icon=ps.get("icon", "fileoutlined"))
            page_state = {
                "route_id": result["routeId"],
                "page_uid": result["pageUid"],
                "tab_uid": result["tabSchemaUid"],
                "grid_uid": result["gridUid"],
            }
            print(f"  + page: {page_title} (tab={page_state['tab_uid']})")
        else:
            print(f"  = page: {page_title} (tab={page_state['tab_uid']})")

        # Compose blocks
        blocks_spec = _build_compose_blocks(ps)
        if blocks_spec:
            result = nb.compose(page_state["tab_uid"], blocks_spec, mode="replace")
            page_state["blocks"] = _extract_block_state(result)
            block_count = len(result.get("blocks", []))
            print(f"    composed {block_count} blocks")

            # Apply layouts
            _apply_all_layouts(nb, result, ps)

            # Configure filter field connections (filterPaths, label)
            _configure_filter_fields(nb, result, ps)

        state["pages"][page_key] = page_state

    return state


def _build_compose_blocks(page_spec: dict) -> list[dict]:
    """Convert page spec blocks to flowSurfaces:compose format."""
    coll = page_spec.get("coll", "")
    blocks = []

    for bs in page_spec.get("blocks", []):
        btype = bs.get("type", "")
        key = bs.get("key", f"{btype}_{len(blocks)}")

        block: dict[str, Any] = {"key": key, "type": btype}

        # Resource binding
        resource = bs.get("resource")
        block_coll = bs.get("coll", coll)
        if resource:
            # Explicit resource (e.g., {binding: currentCollection} for popups)
            block["resource"] = resource
        elif block_coll and btype != "filterForm":
            block["resource"] = {
                "collectionName": block_coll,
                "dataSourceKey": "main",
            }

        # Fields
        fields = bs.get("fields", []) or bs.get("columns", [])
        if fields:
            block["fields"] = [_parse_compose_field(f) for f in fields]

        # Actions
        actions = bs.get("actions", [])
        if actions:
            block["actions"] = [_parse_compose_action(a) for a in actions]

        # Record actions
        record_actions = bs.get("recordActions", [])
        if record_actions:
            block["recordActions"] = [_parse_compose_action(a) for a in record_actions]

        # Settings
        settings = bs.get("settings", {})
        if settings:
            block["settings"] = settings

        blocks.append(block)

    return blocks


def _parse_compose_field(f) -> dict:
    """Parse field spec for compose API."""
    if isinstance(f, str):
        # Simple: "title" or "title>embed" or "status:enum"
        s = f.strip()
        result: dict[str, Any] = {}

        if ">" in s:
            s, mode = s.split(">", 1)
            result["popup"] = {"mode": mode.strip()}

        # Strip type hint (compose auto-infers from collection metadata)
        if ":" in s:
            s, _ = s.split(":", 1)

        result["fieldPath"] = s.strip()
        return result

    if isinstance(f, dict):
        result: dict[str, Any] = {}
        # "field" key → fieldPath for compose API
        fp = f.get("field", f.get("fieldPath", f.get("name", "")))
        if fp:
            result["fieldPath"] = fp
        # Pass through other compose-supported keys
        for k in ("target", "popup", "renderer", "type", "associationPathName"):
            if k in f:
                result[k] = f[k]
        return result

    return {"fieldPath": str(f)}


def _parse_compose_action(a) -> dict:
    """Parse action spec for compose API."""
    if isinstance(a, str):
        return {"type": a}
    if isinstance(a, dict):
        return a
    return {"type": str(a)}


# ══════════════════════════════════════════════════════════════════
#  Layer 2: Enhance — popups, JS, event flows
# ══════════════════════════════════════════════════════════════════

def deploy_l2(nb: NocoBase, spec: dict, state: dict, mod: Path):
    """Deploy Layer 2: popup content, JS code, event flows.

    All targets use $variable references resolved from state.yaml:
      $产品管理.table.actions.addNew     → popup_grid UID
      $产品管理.table.fields.status      → field UID
    """
    from refs import RefResolver

    print(f"\n  ── Layer 2: Enhance ──")

    resolver = RefResolver(state)

    # Expand auto-derived popups (edit, view from addNew)
    all_popups = _expand_auto_popups(spec.get("popups", []))

    for popup_spec in all_popups:
        target_ref = popup_spec.get("target", "")
        try:
            target_uid = resolver.resolve_uid(target_ref)
        except KeyError as e:
            print(f"  ! popup: {e}")
            continue

        blocks = _build_compose_blocks(popup_spec)
        if not blocks:
            continue

        try:
            existing = nb.get(uid=target_uid)
            items = _find_popup_items(existing.get("tree", {}))
            has_content = bool(items)
        except Exception:
            has_content = False
            items = []

        try:
            if has_content:
                print(f"  = popup [{target_ref}]: {len(items)} blocks (layout only)")
                _relayout_existing_popup(nb, items, popup_spec)
            else:
                result = nb.compose(target_uid, blocks, mode="replace")
                block_count = len(result.get("blocks", []))
                print(f"  + popup [{target_ref}]: {block_count} blocks")
                _apply_popup_layouts(nb, result, popup_spec)
        except Exception as e:
            print(f"  ! popup [{target_ref}]: {e}")

        # If this is a view popup bound to field click, set click-to-open
        view_field = popup_spec.get("_view_field")
        view_target = popup_spec.get("_view_target_ref")
        if view_field and view_target:
            try:
                field_uid = resolver.resolve_uid(view_target)
                # Read the field to get its popup page UID
                field_data = nb.get(uid=field_uid)
                field_tree = field_data.get("tree", {})
                popup_page_uid = (field_tree.get("subModels", {})
                                  .get("page", {}).get("uid", ""))
                # Get collection from expanded popup spec or structure
                coll = popup_spec.get("_view_coll", "")

                # openView.uid must point to the field ITSELF (not ChildPageModel)
                # NocoBase uses the field UID to locate its popup subtree
                # TODO: switch to flowSurfaces:configure when supported
                nb.update_model(field_uid, {
                    "popupSettings": {
                        "openView": {
                            "collectionName": coll,
                            "dataSourceKey": "main",
                            "mode": "drawer",
                            "size": "large",
                            "pageModelClass": "ChildPageModel",
                            "uid": field_uid,  # self-reference
                        }
                    },
                    "displayFieldSettings": {
                        "clickToOpen": {"clickToOpen": True}
                    },
                })
                print(f"    → click [{view_field}] opens detail")
            except Exception as e:
                print(f"    ! view_field bind: {e}")

    for js_spec in spec.get("js", []):
        target_ref = js_spec.get("target", "")
        code = js_spec.get("code", "")
        code_file = js_spec.get("file", "")

        if code_file and not code:
            p = mod / code_file
            if p.exists():
                code = p.read_text()

        if target_ref and code:
            try:
                target_uid = resolver.resolve_uid(target_ref)
                title = js_spec.get("title", "")
                changes: dict = {"code": code}
                if title:
                    changes["title"] = title
                nb.configure(target_uid, {"changes": changes})
                print(f"  + js [{target_ref}]: {len(code)} chars")
            except KeyError as e:
                print(f"  ! js: {e}")
            except RuntimeError as e:
                # Fallback to legacy update_model for nodes configure doesn't support
                try:
                    sp_patch: dict = {"jsSettings": {"runJs": {"code": code, "version": "v1"}}}
                    if title:
                        sp_patch["tableColumnSettings"] = {"title": {"title": title}}
                    nb.update_model(target_uid, sp_patch)
                    print(f"  + js [{target_ref}]: {len(code)} chars (legacy)")
                except Exception as e2:
                    print(f"  ! js [{target_ref}]: {e2}")

    for event_spec in spec.get("events", []):
        target_ref = event_spec.get("target", "")
        flows = event_spec.get("flows", {})
        if not target_ref or not flows:
            continue
        try:
            target_uid = resolver.resolve_uid(target_ref)
        except KeyError as e:
            print(f"  ! event: {e}")
            continue
        try:
            nb.set_event_flows(target_uid, {"flowRegistry": flows})
            print(f"  + events [{target_ref}]")
        except Exception as e:
            print(f"  ! events [{target_ref}]: {e}")



# ══════════════════════════════════════════════════════════════════
#  Helpers
# ══════════════════════════════════════════════════════════════════

def _apply_all_layouts(nb: NocoBase, compose_result: dict, page_spec: dict):
    """Apply layouts at all levels:
    1. Page-level: block arrangement (from page_spec.layout)
    2. Block-level: field arrangement in filter/form/detail (from block.field_layout)

    Layout DSL in structure.yaml:

      layout:                              # page-level
        - [filter]                         # row 1: full width
        - [{sidebar: 6}, {table: 18}]     # row 2: side by side

      blocks:
        - key: filter
          type: filterForm
          fields: [name, category, status, industry, owner]
          field_layout:                    # field-level
            - [name, category, status]     # 3 per row (auto 8,8,8)
            - [industry, owner]            # 2 per row (auto 12,12)

    If no layout specified, auto-generates:
    - Page: one block per row, full width
    - FilterForm fields: max 3 per row
    - Form/Detail fields: max 2 per row
    """
    blocks = compose_result.get("blocks", [])
    block_specs = {bs.get("key", ""): bs for bs in page_spec.get("blocks", [])}

    # ── 1. Page-level block layout ──
    page_layout = page_spec.get("layout")
    if page_layout:
        # Build uid_map from block keys
        page_grid_uid = compose_result.get("layout", {}).get("uid")
        if page_grid_uid:
            uid_map = {b["key"]: b["uid"] for b in blocks}
            layout = parse_layout_spec(page_layout, list(uid_map.keys()))
            if apply_layout(nb, page_grid_uid, layout, uid_map):
                print(f"      page layout: {describe_layout(layout)}")

    # ── 2. Block-level field layouts ──
    for b in blocks:
        btype = b.get("type", "")
        bkey = b.get("key", "")
        grid_uid = b.get("gridUid")
        field_results = b.get("fields", [])
        bs = block_specs.get(bkey, {})

        if not grid_uid or not field_results:
            continue

        # Build field name → wrapper UID map
        field_uid_map = {}
        field_names = []
        for f in field_results:
            name = f.get("fieldPath", f.get("key", ""))
            uid = f.get("wrapperUid", f.get("uid"))
            field_uid_map[name] = uid
            field_names.append(name)

        # Determine layout
        if btype == "filterForm":
            max_per_row = 3
        elif btype in ("form", "editForm"):
            max_per_row = 2
        elif btype == "detail":
            max_per_row = 2
        else:
            continue  # table doesn't need field layout

        # Use explicit field_layout if provided, otherwise auto
        explicit = bs.get("field_layout")
        layout = parse_layout_spec(explicit, field_names, max_per_row)

        if apply_layout(nb, grid_uid, layout, field_uid_map):
            print(f"      {bkey} field layout: {describe_layout(layout)}")

        # Set block horizontal label mode for filter forms
        if btype == "filterForm":
            try:
                nb.update_settings(b["uid"], {
                    "settings": {
                        "formFilterBlockModelSettings": {
                            "layout": {
                                "layout": "horizontal",
                                "labelAlign": "left",
                                "labelWidth": 120,
                                "labelWrap": False,
                                "colon": True,
                            }
                        }
                    }
                })
            except Exception:
                pass


def _configure_filter_fields(nb: NocoBase, compose_result: dict, page_spec: dict):
    """Configure filterForm field connections (filterPaths, label).

    When a filter field has filterPaths: [field1, field2], one input
    searches multiple columns. Uses flowSurfaces:configure to set
    filterFormItemSettings.connectFields on the wrapper UID.
    """
    blocks = compose_result.get("blocks", [])
    block_specs = page_spec.get("blocks", [])

    for b in blocks:
        if b.get("type") != "filterForm":
            continue

        # Find the matching spec
        bkey = b.get("key", "")
        bs = next((s for s in block_specs if s.get("key") == bkey), None)
        if not bs:
            continue

        # Find the target table block UID (for defaultTargetUid)
        table_uid = None
        for ob in blocks:
            if ob.get("type") == "table":
                table_uid = ob.get("uid")
                break

        fields_spec = bs.get("fields", [])
        field_results = b.get("fields", [])

        for fs in fields_spec:
            if not isinstance(fs, dict):
                continue
            filter_paths = fs.get("filterPaths")
            label = fs.get("label")
            if not filter_paths and not label:
                continue

            # Find the wrapper UID for this field
            field_name = fs.get("field", fs.get("name", ""))
            fr = next((f for f in field_results if f.get("fieldPath") == field_name), None)
            if not fr:
                continue

            wrapper_uid = fr.get("wrapperUid", fr.get("uid"))

            # Build settings update
            settings: dict = {}
            if filter_paths and table_uid:
                settings["connectFields"] = {
                    "value": {
                        "targets": [{
                            "targetId": table_uid,
                            "filterPaths": filter_paths,
                        }]
                    }
                }
            if label:
                settings["label"] = {"label": label}

            if settings:
                try:
                    nb.update_settings(wrapper_uid, {
                        "settings": {"filterFormItemSettings": settings}
                    })
                    paths_str = f" → {filter_paths}" if filter_paths else ""
                    print(f"      filter {field_name}: {label or field_name}{paths_str}")
                except Exception as e:
                    print(f"      ! filter {field_name}: {e}")


def _expand_auto_popups(popups: list[dict]) -> list[dict]:
    """Expand auto-derived popups from addNew definitions.

    When a popup has `auto: [edit, view]`, generates:
    - edit popup: same fields/layout, type=editForm, resource=currentRecord
    - view popup: same fields/layout, type=details, resource=currentRecord,
                  recordActions=[edit] instead of actions=[submit]

    When `view_field` is set, the view popup is bound to clicking
    that field in the table (instead of a separate view button).
    """
    import copy
    result = []

    for ps in popups:
        result.append(ps)  # always include the original

        auto = ps.get("auto", [])
        if not auto:
            continue

        target_ref = ps.get("target", "")
        # Derive base path: $xxx.table.actions.addNew → $xxx.table
        # So edit = $xxx.table.record_actions.edit
        parts = target_ref.rstrip(".").split(".")
        # Find the block key part (before "actions")
        base_parts = []
        for p in parts:
            if p in ("actions", "record_actions"):
                break
            base_parts.append(p)
        base_ref = ".".join(base_parts)

        blocks_spec = ps.get("blocks", [])
        if not blocks_spec:
            continue
        src_block = blocks_spec[0]  # the createForm definition

        view_field = ps.get("view_field")

        if "edit" in auto:
            edit_block = copy.deepcopy(src_block)
            edit_block["key"] = "form"
            edit_block["type"] = "editForm"
            edit_block["resource"] = {"binding": "currentRecord"}

            edit_popup = {
                "target": f"{base_ref}.record_actions.edit",
                "blocks": [edit_block],
            }
            result.append(edit_popup)

        if "view" in auto:
            view_block = copy.deepcopy(src_block)
            view_block["key"] = "detail"
            view_block["type"] = "details"
            view_block["resource"] = {"binding": "currentRecord"}
            # details uses recordActions, not actions
            view_block.pop("actions", None)
            view_block["recordActions"] = ["edit"]

            # Get collection from popup spec or source block
            src_coll = ps.get("coll", src_block.get("coll", ""))

            if view_field:
                # View binds to field click, not record_actions.view
                view_popup = {
                    "target": f"{base_ref}.fields.{view_field}",
                    "blocks": [view_block],
                    "_view_field": view_field,
                    "_view_target_ref": f"{base_ref}.fields.{view_field}",
                    "_view_coll": src_coll,
                }
            else:
                view_popup = {
                    "target": f"{base_ref}.record_actions.view",
                    "blocks": [view_block],
                }
            result.append(view_popup)

    return result


def _find_popup_items(tree: dict) -> list[dict]:
    """Navigate popup tree to find block items.

    Path: Action → page(ChildPage) → tabs[Tab] → grid(BlockGrid) → items
    """
    subs = tree.get("subModels", {})

    # Direct grid.items (if target is already a grid/tab)
    grid = subs.get("grid", {})
    if isinstance(grid, dict) and grid.get("subModels", {}).get("items"):
        items = grid["subModels"]["items"]
        return items if isinstance(items, list) else [items]

    items = subs.get("items", [])
    if isinstance(items, list) and items and items[0].get("use", "").endswith("BlockModel"):
        return items

    # Navigate deeper: page → tabs → grid → items
    page = subs.get("page", {})
    if isinstance(page, dict):
        tabs = page.get("subModels", {}).get("tabs", [])
        if isinstance(tabs, list):
            for tab in tabs:
                tab_grid = tab.get("subModels", {}).get("grid", {})
                if isinstance(tab_grid, dict):
                    tab_items = tab_grid.get("subModels", {}).get("items", [])
                    if isinstance(tab_items, list) and tab_items:
                        return tab_items
        elif isinstance(tabs, dict):
            tab_grid = tabs.get("subModels", {}).get("grid", {})
            if isinstance(tab_grid, dict):
                tab_items = tab_grid.get("subModels", {}).get("items", [])
                if isinstance(tab_items, list) and tab_items:
                    return tab_items

    return []


def _relayout_existing_popup(nb: NocoBase, items: list[dict], popup_spec: dict):
    """Re-apply layout to existing popup blocks without recreating them.

    Only calls setLayout — UIDs stay the same.
    """
    block_specs = {bs.get("key", ""): bs for bs in popup_spec.get("blocks", [])}

    for item in items:
        use = item.get("use", "")
        grid = item.get("subModels", {}).get("grid", {})
        grid_uid = grid.get("uid")
        if not grid_uid:
            continue

        # Find matching block spec by type
        type_map = {
            "CreateFormModel": "createForm",
            "EditFormModel": "editForm",
            "DetailsBlockModel": "details",
        }
        btype = type_map.get(use, "")
        bs = None
        for k, v in block_specs.items():
            if v.get("type") == btype:
                bs = v
                break
        if not bs or not bs.get("field_layout"):
            continue

        # Build field name → wrapper UID map from existing items
        grid_items = grid.get("subModels", {}).get("items", [])
        if not isinstance(grid_items, list):
            grid_items = [grid_items] if grid_items else []

        field_uid_map = {}
        for fi in grid_items:
            fp = (fi.get("stepParams", {})
                   .get("fieldSettings", {})
                   .get("init", {})
                   .get("fieldPath", ""))
            label = (fi.get("stepParams", {})
                      .get("markdownItemSetting", {})
                      .get("title", {})
                      .get("label", ""))
            uid = fi.get("uid", "")
            if fp:
                field_uid_map[fp] = uid
            if label:
                field_uid_map[label] = uid
                field_uid_map[f"divider.{label}"] = uid

        layout = bs.get("field_layout", [])

        # Check for new dividers that don't exist yet
        for row in layout:
            if isinstance(row, str) and row.strip().startswith("---"):
                label = row.strip().strip("-").strip()
                if label not in field_uid_map:
                    divider_uid = nb.add_divider(grid_uid, label)
                    field_uid_map[label] = divider_uid
                    field_uid_map[f"divider.{label}"] = divider_uid
                    print(f"      + divider: {label}")

        if apply_layout(nb, grid_uid, layout, field_uid_map):
            print(f"      relayout: {describe_layout(layout)}")


def _apply_popup_layouts(nb: NocoBase, compose_result: dict, popup_spec: dict):
    """Apply field layouts inside popup blocks, including dividers."""
    block_specs = {bs.get("key", ""): bs for bs in popup_spec.get("blocks", [])}
    for b in compose_result.get("blocks", []):
        bkey = b.get("key", "")
        grid_uid = b.get("gridUid")
        bs = block_specs.get(bkey, {})
        field_results = b.get("fields", [])

        if not grid_uid or not field_results:
            continue

        field_uid_map = {
            f.get("fieldPath", f.get("key", "")): f.get("wrapperUid", f.get("uid"))
            for f in field_results
        }
        field_names = [f.get("fieldPath", f.get("key", "")) for f in field_results]

        layout = bs.get("field_layout")
        if not layout:
            max_per_row = 2
            layout = parse_layout_spec(None, field_names, max_per_row)

        # Create dividers for "--- label ---" rows (legacy API)
        # TODO: switch to flowSurfaces when divider support is added
        for row in layout:
            if isinstance(row, str) and row.strip().startswith("---"):
                label = row.strip().strip("-").strip()
                divider_uid = nb.add_divider(grid_uid, label)
                field_uid_map[label] = divider_uid
                field_uid_map[f"divider.{label}"] = divider_uid
                print(f"      + divider: {label}")

        if apply_layout(nb, grid_uid, layout, field_uid_map):
            print(f"      {bkey} layout: {describe_layout(layout)}")


def _extract_block_state(compose_result: dict) -> dict:
    """Extract deep UID registry from compose response.

    State structure (AI reads this to find any UID):
      blocks:
        filter:
          uid: aaa
          type: filterForm
          grid_uid: bbb
          fields:
            product_name: {wrapper: ccc, field: ddd}
            status: {wrapper: eee, field: fff}
          actions: {}
        table:
          uid: ggg
          type: table
          actions_column_uid: hhh
          fields:
            sku: {wrapper: iii, field: jjj}
          actions:
            filter: {uid: kkk}
            addNew: {uid: lll, popup_page: mmm, popup_tab: nnn, popup_grid: ooo}
          record_actions:
            edit: {uid: ppp, popup_page: qqq, popup_tab: rrr, popup_grid: sss}
    """
    blocks = {}
    for b in compose_result.get("blocks", []):
        key = b["key"]
        entry: dict = {
            "uid": b["uid"],
            "type": b["type"],
        }

        # Optional UIDs
        if b.get("gridUid"):
            entry["grid_uid"] = b["gridUid"]
        if b.get("actionsColumnUid"):
            entry["actions_column_uid"] = b["actionsColumnUid"]

        # Fields — deep UID
        fields = {}
        for f in b.get("fields", []):
            fp = f.get("fieldPath", f.get("key", ""))
            field_entry: dict = {
                "wrapper": f.get("wrapperUid", f.get("uid")),
                "field": f.get("fieldUid", ""),
            }
            if f.get("popupPageUid"):
                field_entry["popup_page"] = f["popupPageUid"]
                field_entry["popup_tab"] = f.get("popupTabUid", "")
                field_entry["popup_grid"] = f.get("popupGridUid", "")
            fields[fp] = field_entry
        if fields:
            entry["fields"] = fields

        # Actions — deep UID
        actions = {}
        for a in b.get("actions", []):
            act_entry: dict = {"uid": a["uid"]}
            if a.get("popupPageUid"):
                act_entry["popup_page"] = a["popupPageUid"]
                act_entry["popup_tab"] = a.get("popupTabUid", "")
                act_entry["popup_grid"] = a.get("popupGridUid", "")
            actions[a["key"]] = act_entry
        if actions:
            entry["actions"] = actions

        # Record actions — deep UID
        rec_actions = {}
        for a in b.get("recordActions", []):
            act_entry: dict = {"uid": a["uid"]}
            if a.get("popupPageUid"):
                act_entry["popup_page"] = a["popupPageUid"]
                act_entry["popup_tab"] = a.get("popupTabUid", "")
                act_entry["popup_grid"] = a.get("popupGridUid", "")
            rec_actions[a["key"]] = act_entry
        if rec_actions:
            entry["record_actions"] = rec_actions

        blocks[key] = entry

    return blocks


def _ensure_collection(nb: NocoBase, name: str, coll_def: dict):
    title = coll_def.get("title", name)
    exists = nb.collection_exists(name)

    if not exists:
        nb.create_collection(name, title)
        print(f"  + collection: {name}")
    else:
        print(f"  = collection: {name}")

    # Always check for new fields (even if collection exists)
    meta = nb.field_meta(name)
    for fdef in coll_def.get("fields", []):
        fname = fdef["name"]
        if fname in meta or fname in ("id", "createdAt", "updatedAt"):
            continue
        iface = fdef.get("interface", "input")
        ftitle = fdef.get("title", fname)
        opts = {}
        if "options" in fdef:
            opts["options"] = fdef["options"]
        try:
            nb.create_field(name, fname, iface, ftitle, **opts)
            print(f"    + {name}.{fname}")
        except Exception as e:
            print(f"    ! {name}.{fname}: {e}")


def _find_group(nb: NocoBase, title: str) -> int | None:
    for r in nb.routes():
        if r.get("type") == "group" and r.get("title") == title:
            return r["id"]
    return None


def _slugify(title: str) -> str:
    import re
    s = title.strip().lower()
    s = re.sub(r'[^a-z0-9\u4e00-\u9fff]+', '-', s)
    return s.strip('-') or title


def _show_plan(spec: dict, enhance_file: Path):
    print(f"\n  Module: {spec.get('module', '?')}")
    print(f"\n  Layer 1:")
    for name in spec.get("collections", {}):
        print(f"    + collection: {name}")
    print(f"    + group: {spec.get('module')}")
    for ps in spec.get("pages", []):
        blocks = ps.get("blocks", [])
        print(f"    + page: {ps['page']} ({len(blocks)} blocks)")
        for b in blocks:
            fields = b.get("fields", b.get("columns", []))
            actions = b.get("actions", [])
            print(f"      {b['type']}: {len(fields)} fields, {len(actions)} actions")

    if enhance_file.exists():
        enhance = yaml.safe_load(enhance_file.read_text()) or {}
        popups = enhance.get("popups", [])
        js_items = enhance.get("js", [])
        print(f"\n  Layer 2:")
        print(f"    {len(popups)} popups, {len(js_items)} JS enhancements")


# ══════════════════════════════════════════════════════════════════
#  CLI
# ══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    module_dir = sys.argv[1]
    dry_run = "--dry" in sys.argv

    layers = []
    if "--l1" in sys.argv:
        layers.append("l1")
    if "--l2" in sys.argv:
        layers.append("l2")

    deploy(module_dir, layers or None, dry_run)
