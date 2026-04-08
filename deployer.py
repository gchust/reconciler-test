"""Deployer v3 — compose skeleton + fill content one by one.

No mixed API modes. Clean separation:
  1. compose → create empty block shells
  2. addField/addAction → fill content (compose-supported types)
  3. save_model → fill content (legacy types: JSItem, Divider, Comments, etc.)
  4. setLayout → arrange everything
  5. state.yaml → track all UIDs

Usage:
    python deployer.py orders/               # deploy module
    python deployer.py orders/ --force       # force recreate (delete + redeploy)
"""

from __future__ import annotations

import json
import random
import string
import sys
from pathlib import Path
from typing import Any

import yaml
from nb import NocoBase, dump_yaml
from layout import build_grid, apply_layout, parse_layout_spec, describe_layout


def uid():
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=11))


# ══════════════════════════════════════════════════════════════════
#  Main entry
# ══════════════════════════════════════════════════════════════════

def deploy(mod_dir: str, force: bool = False):
    mod = Path(mod_dir)
    structure = yaml.safe_load((mod / "structure.yaml").read_text())
    enhance = {}
    if (mod / "enhance.yaml").exists():
        enhance = yaml.safe_load((mod / "enhance.yaml").read_text()) or {}
    state_file = mod / "state.yaml"
    state = yaml.safe_load(state_file.read_text()) if state_file.exists() else {}

    nb = NocoBase()
    print(f"  Connected to {nb.base}")

    # Collections
    for name, coll_def in structure.get("collections", {}).items():
        _ensure_collection(nb, name, coll_def)

    # Group
    module_name = structure.get("module", "Untitled")
    icon = structure.get("icon", "appstoreoutlined")
    group_id = state.get("group_id") or _find_group(nb, module_name)
    if not group_id:
        result = nb.create_group(module_name, icon=icon)
        group_id = result["routeId"]
        print(f"  + group: {module_name}")
    else:
        print(f"  = group: {module_name}")
    state["group_id"] = group_id
    state.setdefault("pages", {})

    # Pages
    for ps in structure.get("pages", []):
        page_title = ps["page"]
        page_key = _slugify(page_title)
        page_state = state["pages"].get(page_key, {})

        if not page_state.get("tab_uid") or force:
            result = nb.create_page(page_title, group_id,
                                    icon=ps.get("icon", "fileoutlined"))
            page_state = {
                "route_id": result["routeId"],
                "page_uid": result["pageUid"],
                "tab_uid": result["tabSchemaUid"],
                "grid_uid": result.get("gridUid", ""),
            }
            print(f"  + page: {page_title}")
        else:
            print(f"  = page: {page_title}")

        # Deploy surface (blocks + layout)
        existing_blocks = page_state.get("blocks", {})
        blocks_state = deploy_surface(nb, page_state["tab_uid"], ps, mod, force,
                                       existing_blocks)
        page_state["blocks"] = blocks_state
        state["pages"][page_key] = page_state

    # Popups
    from refs import RefResolver
    resolver = RefResolver(state)
    popups = _expand_popups(enhance.get("popups", []))

    for popup_spec in popups:
        target_ref = popup_spec.get("target", "")
        try:
            target_uid = resolver.resolve_uid(target_ref)
        except KeyError as e:
            print(f"  ! popup {target_ref}: {e}")
            continue

        _deploy_popup(nb, target_uid, target_ref, popup_spec, state, mod, force)

    # Save state
    state_file.write_text(dump_yaml(state))
    print(f"\n  State saved. Done.")


# ══════════════════════════════════════════════════════════════════
#  Surface deployment (page or popup tab)
# ══════════════════════════════════════════════════════════════════

def deploy_surface(nb: NocoBase, tab_uid: str, spec: dict,
                   mod: Path, force: bool = False,
                   existing_state: dict = None) -> dict:
    """Deploy blocks into a surface (page tab or popup tab).

    Incremental: if existing_state has block UIDs, skip those blocks.
    Returns blocks state dict {key: {uid, type, ...}}.
    """
    coll = spec.get("coll", "")
    blocks_spec = spec.get("blocks", [])
    if not blocks_spec:
        return existing_state or {}

    existing = existing_state or {}
    blocks_state = dict(existing)  # preserve existing UIDs

    # Check if all blocks already exist in state
    all_exist = all(
        bs.get("key", f"{bs.get('type','')}_{i}") in existing
        for i, bs in enumerate(blocks_spec)
    )

    if all_exist and not force:
        # All blocks exist — only update layout
        print(f"    = {len(existing)} blocks exist (skip compose)")
        # Still apply layout in case it changed
        grid_uid = ""
        for getter in [lambda: nb.get(tabSchemaUid=tab_uid), lambda: nb.get(uid=tab_uid)]:
            try:
                data = getter()
                g = data.get("tree", {}).get("subModels", {}).get("grid", {})
                if isinstance(g, dict) and g.get("uid"):
                    grid_uid = g["uid"]
                    break
            except Exception:
                continue

        layout_spec = spec.get("layout")
        if layout_spec and grid_uid:
            uid_map = {k: v["uid"] for k, v in blocks_state.items() if "uid" in v}
            layout = parse_layout_spec(layout_spec, list(uid_map.keys()))
            apply_layout(nb, grid_uid, layout, uid_map)

        return blocks_state

    # Step 1: Compose empty block shells (only new ones)
    compose_blocks = []
    for bs in blocks_spec:
        key = bs.get("key", f"{bs.get('type','')}_{len(compose_blocks)}")
        if key in existing and not force:
            continue  # skip existing
        cb = _to_compose_block(bs, coll)
        if cb:
            compose_blocks.append(cb)

    if compose_blocks:
        try:
            # Use append mode if some blocks already exist, replace if fresh
            mode = "append" if existing else "replace"
            result = nb.compose(tab_uid, compose_blocks, mode=mode)
            composed = result.get("blocks", [])
            print(f"    composed {len(composed)} block shells")

            # Map compose results to spec keys
            compose_idx = 0
            for bs in blocks_spec:
                key = bs.get("key", "")
                if key in existing and not force:
                    continue
                cb = _to_compose_block(bs, coll)
                if not cb:
                    continue
                if compose_idx < len(composed):
                    cr = composed[compose_idx]
                    blocks_state[key] = {
                        "uid": cr["uid"],
                        "type": cr["type"],
                        "grid_uid": cr.get("gridUid", ""),
                    }
                    compose_idx += 1

            # Step 2: Fill each NEW block with content
            for bs in blocks_spec:
                key = bs.get("key", "")
                if key in existing and not force:
                    continue
                if key not in blocks_state:
                    continue
                block_uid = blocks_state[key]["uid"]
                block_grid = blocks_state[key].get("grid_uid", "")
                _fill_block(nb, block_uid, block_grid, bs, coll, mod, blocks_state[key])

        except Exception as e:
            print(f"    ! compose: {e}")
            return blocks_state

    # Step 3: Add legacy blocks (not compose-supported)
    # Find grid_uid — try multiple paths (page tab, popup tab, or direct node)
    grid_uid = ""
    for getter in [
        lambda: nb.get(tabSchemaUid=tab_uid),
        lambda: nb.get(uid=tab_uid),
    ]:
        try:
            data = getter()
            tree = data.get("tree", {})
            # Direct grid
            grid = tree.get("subModels", {}).get("grid", {})
            if isinstance(grid, dict) and grid.get("uid"):
                grid_uid = grid["uid"]
                break
            # Popup path: field → page → tabs[0] → grid
            popup = tree.get("subModels", {}).get("page", {})
            if popup:
                tabs = popup.get("subModels", {}).get("tabs", [])
                if isinstance(tabs, list) and tabs:
                    g = tabs[0].get("subModels", {}).get("grid", {})
                    if isinstance(g, dict) and g.get("uid"):
                        grid_uid = g["uid"]
                        break
        except Exception:
            continue

    if grid_uid:
        for bs in blocks_spec:
            key = bs.get("key", "")
            if key in blocks_state:
                continue  # already created by compose
            btype = bs.get("type", "")
            block_uid = _create_legacy_block(nb, grid_uid, bs, coll, mod)
            if block_uid:
                blocks_state[key] = {"uid": block_uid, "type": btype}

    # Step 4: Layout
    layout_spec = spec.get("layout")
    if layout_spec and grid_uid:
        uid_map = {k: v["uid"] for k, v in blocks_state.items()}
        layout = parse_layout_spec(layout_spec, list(uid_map.keys()))
        apply_layout(nb, grid_uid, layout, uid_map)
        print(f"    layout: {describe_layout(layout)}")

    return blocks_state


# ══════════════════════════════════════════════════════════════════
#  Compose block shell (no fields/actions — just the container)
# ══════════════════════════════════════════════════════════════════

# Types that compose can create (even as empty shells)
COMPOSE_TYPES = {
    "table", "filterForm", "createForm", "editForm", "details",
    "list", "gridCard", "jsBlock", "chart", "markdown", "iframe",
}

# Types that need legacy API
LEGACY_TYPES = {"comments", "recordHistory"}


def _to_compose_block(bs: dict, default_coll: str) -> dict | None:
    """Convert block spec to compose-compatible shell (no fields/actions)."""
    btype = bs.get("type", "")
    key = bs.get("key", btype)

    if btype not in COMPOSE_TYPES:
        return None

    # Skip association-bound blocks (compose doesn't handle associationName)
    res_binding = bs.get("resource_binding", {})
    if res_binding.get("associationName"):
        return None

    block: dict[str, Any] = {"key": key, "type": btype}

    # Resource
    resource = bs.get("resource")
    block_coll = bs.get("coll", default_coll)
    if resource:
        block["resource"] = resource
    elif res_binding.get("filterByTk"):
        block["resource"] = {"binding": "currentRecord"}
    elif block_coll and btype not in ("filterForm", "jsBlock", "chart", "markdown"):
        block["resource"] = {"collectionName": block_coll, "dataSourceKey": "main"}

    return block


# ══════════════════════════════════════════════════════════════════
#  Fill block content
# ══════════════════════════════════════════════════════════════════

def _fill_block(nb: NocoBase, block_uid: str, grid_uid: str,
                bs: dict, default_coll: str, mod: Path,
                block_state: dict):
    """Fill a compose-created block with fields, actions, JS items, dividers."""
    btype = bs.get("type", "")
    coll = bs.get("coll", default_coll)

    # ── Fields ──
    fields = bs.get("fields", [])
    field_states = {}
    for f in fields:
        fp = f if isinstance(f, str) else f.get("field", f.get("fieldPath", f.get("name", "")))
        if not fp:
            continue
        # compose already added fields — we just track UIDs
        # (compose with empty shell won't add fields, so we need addField)

    # Actually, compose shell has NO fields. Add them now.
    if fields and btype in ("table", "filterForm", "createForm", "editForm", "details"):
        for f in fields:
            fp = f if isinstance(f, str) else f.get("field", f.get("fieldPath", ""))
            if not fp or fp.startswith("["):
                continue
            try:
                result = nb.add_field(block_uid, fp)
                field_states[fp] = {
                    "wrapper": result.get("wrapperUid", result.get("uid", "")),
                    "field": result.get("fieldUid", ""),
                }
            except Exception as e:
                print(f"      ! field {fp}: {e}")

    block_state["fields"] = field_states

    # ── JS Block code ──
    if btype == "jsBlock":
        js_file = bs.get("file", "")
        if js_file:
            p = mod / js_file
            if p.exists():
                code = p.read_text()
                try:
                    nb.configure(block_uid, {"changes": {"code": code}})
                except Exception:
                    nb.update_model(block_uid, {
                        "jsSettings": {"runJs": {"code": code, "version": "v1"}}
                    })

    # ── Chart config ──
    if btype == "chart":
        config_file = bs.get("chart_config", "")
        if config_file:
            p = mod / config_file
            if p.exists():
                config = json.loads(p.read_text())
                try:
                    nb.configure(block_uid, {"changes": config})
                except Exception:
                    nb.update_model(block_uid, {"chartSettings": {"configure": config}})
                # flowSql:save + run
                sql = config.get("query", {}).get("sql", "")
                if sql:
                    import re
                    nb.s.post(f"{nb.base}/api/flowSql:save", json={
                        "type": "selectRows", "uid": block_uid,
                        "dataSourceKey": "main", "sql": sql, "bind": {},
                    }, timeout=30)
                    clean = re.sub(r"\{%\s*if\s+[^%]*%\}.*?\{%\s*endif\s*%\}", "", sql, flags=re.DOTALL)
                    clean = "\n".join(l for l in clean.split("\n") if "{{" not in l and "{%" not in l)
                    nb.s.post(f"{nb.base}/api/flowSql:run", json={
                        "type": "selectRows", "uid": block_uid,
                        "dataSourceKey": "main", "sql": clean, "bind": {},
                    }, timeout=30)

    # ── Actions ──
    actions = list(bs.get("actions", []))
    record_actions = list(bs.get("recordActions", []))

    # Auto-fix: edit/delete on details → recordActions
    if btype == "details":
        for a in list(actions):
            if a in ("edit", "delete", "duplicate", "view"):
                record_actions.append(a)
                actions.remove(a)

    action_states = {}
    for a in actions:
        atype = a if isinstance(a, str) else a.get("type", "")
        try:
            result = nb.add_action(block_uid, atype)
            action_states[atype] = {"uid": result.get("uid", "")}
        except Exception as e:
            print(f"      ! action {atype}: {e}")

    rec_action_states = {}
    for a in record_actions:
        atype = a if isinstance(a, str) else a.get("type", "")
        try:
            result = nb.add_record_action(block_uid, atype)
            rec_action_states[atype] = {"uid": result.get("uid", "")}
        except Exception as e:
            print(f"      ! recordAction {atype}: {e}")

    if action_states:
        block_state["actions"] = action_states
    if rec_action_states:
        block_state["record_actions"] = rec_action_states

    # ── JS Items (inside detail/form grid) ──
    js_items = bs.get("js_items", [])
    js_item_uids: dict[str, str] = {}  # desc → uid (for layout)
    if js_items and grid_uid:
        for js_spec in js_items:
            js_file = js_spec.get("file", "")
            if not js_file:
                continue
            p = mod / js_file
            if not p.exists():
                continue
            code = p.read_text()
            js_uid = uid()
            nb.save_model({
                "uid": js_uid, "use": "JSItemModel",
                "parentId": grid_uid, "subKey": "items", "subType": "array",
                "sortIndex": 0, "flowRegistry": {},
                "stepParams": {"jsSettings": {"runJs": {"code": code, "version": "v1"}}},
            })
            desc = js_spec.get("desc", "")
            if desc:
                js_item_uids[f"[JS:{desc}]"] = js_uid
            print(f"      + JS: {desc[:40]}")

    # ── JS Columns (table) ──
    js_cols = bs.get("js_columns", [])
    for jc in js_cols:
        jc_file = jc.get("file", "")
        jc_title = jc.get("title", "")
        if not jc_file:
            continue
        p = mod / jc_file
        if not p.exists():
            continue
        code = p.read_text()
        try:
            result = nb.add_field(block_uid, "jsColumn", type="jsColumn")
            jc_uid = result.get("uid", "")
            nb.configure(jc_uid, {"changes": {"code": code, "title": jc_title}})
            print(f"      + JSCol: {jc_title}")
        except Exception as e:
            print(f"      ! JSCol {jc_title}: {e}")

    # ── Dividers ──
    # Check field_layout for "--- label ---" entries
    field_layout = bs.get("field_layout", [])
    divider_uids = {}
    for row in field_layout:
        if isinstance(row, str) and row.strip().startswith("---"):
            label = row.strip().strip("-").strip()
            if label and grid_uid:
                div_uid = nb.add_divider(grid_uid, label)
                divider_uids[label] = div_uid

    # ── Field layout ──
    if field_layout and grid_uid:
        # Build uid map: field names + divider labels + JS items
        layout_uid_map = {}
        for fp, finfo in field_states.items():
            layout_uid_map[fp] = finfo["wrapper"]
        for label, div_uid in divider_uids.items():
            layout_uid_map[label] = div_uid
            layout_uid_map[f"divider.{label}"] = div_uid
        # JS items by their [JS:desc] layout reference
        layout_uid_map.update(js_item_uids)

        if layout_uid_map:
            apply_layout(nb, grid_uid, field_layout, layout_uid_map)

    # ── Filter field connections (filterPaths) ──
    if btype == "filterForm":
        _configure_filter(nb, bs, block_uid, field_states, default_coll)

    # ── Block title ──
    title = bs.get("title", "")
    if title:
        try:
            nb.update_model(block_uid, {
                "cardSettings": {"titleDescription": {"title": title}}
            })
        except Exception:
            pass


def _configure_filter(nb: NocoBase, bs: dict, block_uid: str,
                      field_states: dict, coll: str):
    """Configure filter field connections."""
    for f in bs.get("fields", []):
        if not isinstance(f, dict):
            continue
        fp = f.get("field", f.get("name", ""))
        label = f.get("label", "")
        filter_paths = f.get("filterPaths")
        if not fp or (not label and not filter_paths):
            continue

        wrapper_uid = field_states.get(fp, {}).get("wrapper", "")
        if not wrapper_uid:
            continue

        settings: dict = {}
        if filter_paths:
            settings["connectFields"] = {"value": {"targets": [{
                "targetId": "",  # will auto-connect
                "filterPaths": filter_paths,
            }]}}
        if label:
            settings["label"] = {"label": label}

        if settings:
            try:
                nb.update_settings(wrapper_uid, {
                    "settings": {"filterFormItemSettings": settings}
                })
                print(f"      filter {fp}: {label or fp}")
            except Exception:
                pass


# ══════════════════════════════════════════════════════════════════
#  Legacy block creation (not supported by compose)
# ══════════════════════════════════════════════════════════════════

def _create_legacy_block(nb: NocoBase, grid_uid: str, bs: dict,
                         default_coll: str, mod: Path = None) -> str | None:
    """Create a block via legacy flowModels:save. Returns UID or None."""
    btype = bs.get("type", "")
    coll = bs.get("coll", default_coll)
    title = bs.get("title", "")
    res_binding = bs.get("resource_binding", {})
    block_uid = uid()

    # Resource init
    res_init: dict = {"dataSourceKey": "main", "collectionName": coll}
    if res_binding.get("filterByTk"):
        res_init["filterByTk"] = res_binding["filterByTk"]
    if res_binding.get("associationName"):
        res_init["associationName"] = res_binding["associationName"]
        res_init["sourceId"] = res_binding.get("sourceId", "{{ctx.view.inputArgs.filterByTk}}")

    sp: dict = {"resourceSettings": {"init": res_init}}
    if title:
        sp["cardSettings"] = {"titleDescription": {"title": title}}

    use_map = {
        "comments": "CommentsBlockModel",
        "recordHistory": "RecordHistoryBlockModel",
        "list": "ListBlockModel",
        "table": "TableBlockModel",
        "details": "DetailsBlockModel",
        "gridCard": "GridCardBlockModel",
    }
    model_use = use_map.get(btype)
    if not model_use:
        return None

    try:
        nb.save_model({
            "uid": block_uid, "use": model_use,
            "parentId": grid_uid, "subKey": "items", "subType": "array",
            "sortIndex": 99, "flowRegistry": {},
            "stepParams": sp,
        })

        # ── Comments: add CommentItemModel child ──
        if btype == "comments":
            nb.save_model({
                "uid": uid(), "use": "CommentItemModel",
                "parentId": block_uid, "subKey": "items", "subType": "array",
                "sortIndex": 0, "stepParams": {}, "flowRegistry": {},
            })

        # ── List/GridCard: add ListItem + fields + JS items + actions ──
        if btype in ("list", "gridCard"):
            _fill_list_block(nb, block_uid, bs, coll, mod)

        print(f"    + {btype}:\"{title}\" (legacy)")
        return block_uid
    except Exception as e:
        print(f"    ! {btype}: {e}")
        return None


def _fill_list_block(nb: NocoBase, block_uid: str, bs: dict,
                     coll: str, mod: Path = None):
    """Fill a ListBlock with ListItem → DetailsGrid → fields/JS items + actions.

    List structure:
      ListBlockModel
        ├── ListItemModel (subKey=item, subType=object)
        │   ├── DetailsGridModel (subKey=grid, subType=object)
        │   │   ├── DetailsItemModel → DisplayField (fields)
        │   │   └── JSItemModel (JS items)
        │   └── EditActionModel (item actions, subKey=actions)
        ├── FilterActionModel (block actions, subKey=actions)
        ├── RefreshActionModel
        └── AddNewActionModel
    """
    # ListItem
    list_item_uid = uid()
    nb.save_model({
        "uid": list_item_uid, "use": "ListItemModel",
        "parentId": block_uid, "subKey": "item", "subType": "object",
        "sortIndex": 0, "stepParams": {}, "flowRegistry": {},
    })

    # DetailsGrid inside ListItem
    detail_grid_uid = uid()
    nb.save_model({
        "uid": detail_grid_uid, "use": "DetailsGridModel",
        "parentId": list_item_uid, "subKey": "grid", "subType": "object",
        "sortIndex": 0, "stepParams": {}, "flowRegistry": {},
    })

    # Item fields (DetailsItem → DisplayField)
    item_fields = bs.get("item_fields", [])
    for i, fp in enumerate(item_fields):
        if isinstance(fp, dict):
            fp = fp.get("field", fp.get("name", ""))
        if not fp:
            continue
        item_uid_val = uid()
        field_uid_val = uid()
        nb.save_model({
            "uid": item_uid_val, "use": "DetailsItemModel",
            "parentId": detail_grid_uid, "subKey": "items", "subType": "array",
            "sortIndex": i + 1, "flowRegistry": {},
            "stepParams": {"fieldSettings": {"init": {
                "dataSourceKey": "main", "collectionName": coll, "fieldPath": fp,
            }}},
        })
        nb.save_model({
            "uid": field_uid_val, "use": "DisplayTextFieldModel",
            "parentId": item_uid_val, "subKey": "field", "subType": "object",
            "sortIndex": 0, "stepParams": {}, "flowRegistry": {},
        })

    # Item JS items
    item_js = bs.get("item_js", [])
    for js_spec in item_js:
        js_file = js_spec.get("file", "")
        if not js_file:
            continue
        code = ""
        if mod:
            p = mod / js_file
            if p.exists():
                code = p.read_text()
        if not code:
            continue
        js_uid_val = uid()
        nb.save_model({
            "uid": js_uid_val, "use": "JSItemModel",
            "parentId": detail_grid_uid, "subKey": "items", "subType": "array",
            "sortIndex": 0, "flowRegistry": {},
            "stepParams": {"jsSettings": {"runJs": {"code": code, "version": "v1"}}},
        })
        desc = js_spec.get("desc", "")
        print(f"      + list JS: {desc[:40]}")

    # Item actions (e.g., edit)
    item_actions = bs.get("item_actions", [])
    action_map = {
        "edit": "EditActionModel", "view": "ViewActionModel",
        "delete": "DeleteActionModel",
    }
    for a in item_actions:
        atype = a if isinstance(a, str) else a.get("type", "")
        model = action_map.get(atype, f"{atype.title()}ActionModel")
        nb.save_model({
            "uid": uid(), "use": model,
            "parentId": list_item_uid, "subKey": "actions", "subType": "array",
            "sortIndex": 0, "stepParams": {}, "flowRegistry": {},
        })

    # Block-level actions (filter, refresh, addNew)
    block_actions = bs.get("actions", [])
    block_action_map = {
        "filter": "FilterActionModel", "refresh": "RefreshActionModel",
        "addNew": "AddNewActionModel", "export": "ExportActionModel",
    }
    for a in block_actions:
        atype = a if isinstance(a, str) else a.get("type", "")
        model = block_action_map.get(atype)
        if model:
            nb.save_model({
                "uid": uid(), "use": model,
                "parentId": block_uid, "subKey": "actions", "subType": "array",
                "sortIndex": 0, "stepParams": {}, "flowRegistry": {},
            })


# ══════════════════════════════════════════════════════════════════
#  Popup deployment
# ══════════════════════════════════════════════════════════════════

def _deploy_popup(nb: NocoBase, target_uid: str, target_ref: str,
                  popup_spec: dict, state: dict, mod: Path, force: bool):
    """Deploy a popup (= sub-page with tabs)."""
    mode = popup_spec.get("mode", "drawer")
    coll = popup_spec.get("coll", "")
    tabs_spec = popup_spec.get("tabs")

    # Check if popup already has content (skip if not forced)
    if not force:
        try:
            data = nb.get(uid=target_uid)
            tree = data.get("tree", {})
            popup_page = tree.get("subModels", {}).get("page", {})
            if popup_page and popup_page.get("subModels", {}).get("tabs"):
                tabs = popup_page["subModels"]["tabs"]
                has_content = False
                for t in (tabs if isinstance(tabs, list) else [tabs]):
                    g = t.get("subModels", {}).get("grid", {})
                    items = g.get("subModels", {}).get("items", [])
                    if isinstance(items, list) and items:
                        has_content = True
                        break
                if has_content:
                    print(f"  = popup [{target_ref}] (exists, skip)")
                    return
        except Exception:
            pass

    # Set click-to-open
    nb.update_model(target_uid, {
        "popupSettings": {
            "openView": {
                "collectionName": coll,
                "dataSourceKey": "main",
                "mode": mode,
                "size": "large",
                "pageModelClass": "ChildPageModel",
                "uid": target_uid,
            }
        },
        "displayFieldSettings": {
            "clickToOpen": {"clickToOpen": True}
        },
    })

    if tabs_spec:
        _deploy_tabbed_popup(nb, target_uid, target_ref, tabs_spec, coll, mod, force)
    else:
        # Simple popup (single set of blocks)
        blocks = popup_spec.get("blocks", [])
        if blocks:
            _deploy_simple_popup(nb, target_uid, target_ref, popup_spec, coll, mod)


def _deploy_simple_popup(nb: NocoBase, target_uid: str, target_ref: str,
                         popup_spec: dict, coll: str, mod: Path):
    """Deploy a simple popup (no tabs, just blocks)."""
    blocks_state = deploy_surface(nb, target_uid, popup_spec, mod)
    print(f"  + popup [{target_ref}]: {len(blocks_state)} blocks")


def _deploy_tabbed_popup(nb: NocoBase, target_uid: str, target_ref: str,
                         tabs_spec: list, coll: str, mod: Path, force: bool):
    """Deploy a multi-tab popup."""
    print(f"  + popup [{target_ref}]: {len(tabs_spec)} tabs")

    # Tab 0: compose on target directly (creates ChildPageModel)
    first_tab = tabs_spec[0]
    first_blocks = deploy_surface(nb, target_uid, first_tab, mod)
    tab_title = first_tab.get("title", "Tab0")
    print(f"    tab '{tab_title}': {len(first_blocks)} blocks")

    # Read popup to get remaining tabs
    try:
        data = nb.get(uid=target_uid)
        popup_page = data.get("tree", {}).get("subModels", {}).get("page", {})
        existing_tabs = popup_page.get("subModels", {}).get("tabs", [])
        if not isinstance(existing_tabs, list):
            existing_tabs = [existing_tabs] if existing_tabs else []
    except Exception:
        existing_tabs = []

    # Remaining tabs
    for i, tab_spec in enumerate(tabs_spec[1:], start=1):
        tab_title = tab_spec.get("title", f"Tab{i}")

        if i < len(existing_tabs):
            tab_uid = existing_tabs[i].get("uid", "")
        else:
            try:
                popup_uid = popup_page.get("uid", "")
                result = nb.add_popup_tab(popup_uid, tab_title)
                tab_uid = result.get("tabUid", result.get("uid", ""))
            except Exception as e:
                print(f"    ! tab '{tab_title}': {e}")
                continue

        tab_blocks = deploy_surface(nb, tab_uid, tab_spec, mod)
        print(f"    tab '{tab_title}': {len(tab_blocks)} blocks")


# ══════════════════════════════════════════════════════════════════
#  Popup expansion (auto-derive edit from addNew)
# ══════════════════════════════════════════════════════════════════

def _expand_popups(popups: list[dict]) -> list[dict]:
    """Expand auto-derived popups."""
    import copy
    result = []
    for ps in popups:
        result.append(ps)
        auto = ps.get("auto", [])
        if not auto:
            continue

        target = ps.get("target", "")
        parts = target.split(".")
        base_parts = []
        for p in parts:
            if p in ("actions", "record_actions"):
                break
            base_parts.append(p)
        base_ref = ".".join(base_parts)

        src_block = ps.get("blocks", [{}])[0]
        coll = ps.get("coll", "")
        view_field = ps.get("view_field")

        if "edit" in auto:
            edit_block = copy.deepcopy(src_block)
            edit_block["type"] = "editForm"
            edit_block["resource"] = {"binding": "currentRecord"}
            result.append({
                "target": f"{base_ref}.record_actions.edit",
                "blocks": [edit_block],
                "coll": coll,
            })

        if "view" in auto and view_field:
            view_block = copy.deepcopy(src_block)
            view_block["type"] = "details"
            view_block["resource"] = {"binding": "currentRecord"}
            view_block.pop("actions", None)
            view_block["recordActions"] = ["edit"]
            result.append({
                "target": f"{base_ref}.fields.{view_field}",
                "mode": "drawer",
                "coll": coll,
                "blocks": [view_block],
            })

    return result


# ══════════════════════════════════════════════════════════════════
#  Helpers
# ══════════════════════════════════════════════════════════════════

def _ensure_collection(nb: NocoBase, name: str, coll_def: dict):
    if nb.collection_exists(name):
        print(f"  = collection: {name}")
    else:
        nb.create_collection(name, coll_def.get("title", name))
        print(f"  + collection: {name}")

    meta = nb.field_meta(name)
    for fdef in coll_def.get("fields", []):
        fname = fdef["name"]
        if fname in meta or fname in ("id", "createdAt", "updatedAt"):
            continue
        try:
            nb.create_field(name, fname, fdef.get("interface", "input"),
                            fdef.get("title", fname),
                            **({k: fdef[k] for k in ["options"] if k in fdef}))
            print(f"    + {name}.{fname}")
        except Exception as e:
            print(f"    ! {name}.{fname}: {e}")


def _find_group(nb: NocoBase, title: str) -> int | None:
    for r in nb.routes():
        if r.get("type") == "group" and r.get("title") == title:
            return r["id"]
    return None


def _slugify(s: str) -> str:
    import re
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", s)
    return s.strip("-") or "item"


# ══════════════════════════════════════════════════════════════════
#  CLI
# ══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    mod_dir = sys.argv[1]
    force = "--force" in sys.argv
    deploy(mod_dir, force)
