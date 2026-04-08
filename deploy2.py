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
        block_coll = bs.get("coll", coll)
        if block_coll and btype != "filterForm":
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
        return f

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

    for popup_spec in spec.get("popups", []):
        target_ref = popup_spec.get("target", "")
        try:
            popup_grid_uid = resolver.resolve_uid(target_ref)
        except KeyError as e:
            print(f"  ! popup: {e}")
            continue

        # Compose blocks inside popup
        blocks = _build_compose_blocks(popup_spec)
        if blocks:
            result = nb.compose(popup_grid_uid, blocks, mode="replace")
            print(f"  + popup [{target_ref}]: {len(result.get('blocks',[]))} blocks")

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
                nb.configure(target_uid, {
                    "changes": [{"path": "jsSettings.runJs.code", "value": code}]
                })
                print(f"  + js [{target_ref}]: {len(code)} chars")
            except KeyError as e:
                print(f"  ! js: {e}")

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
            nb.set_event_flows(target_uid, {"eventFlows": flows})
            print(f"  + events [{target_uid}]")



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
