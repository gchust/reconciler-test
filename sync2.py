"""Sync: live NocoBase → structure.yaml + state.yaml (reverse of deploy2).

Exports existing pages into the same layered format that deploy2 consumes.
Round-trip: sync → edit → deploy → sync = same result.

Usage:
    python sync2.py                         # list all routes
    python sync2.py "库存管理v2" inventory2/  # export group → module dir
    python sync2.py --page "产品管理" out/    # export single page
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import yaml
from nb import NocoBase, dump_yaml


def sync_list(nb: NocoBase):
    """List all routes."""
    routes = nb.routes()
    print("\n  Routes:\n")
    _print_routes(routes)
    print(f"\n  Usage: sync2.py \"Group Name\" <output_dir>")


def sync_group(nb: NocoBase, group_name: str, out_dir: str):
    """Export a group + its pages to structure.yaml + state.yaml."""
    routes = nb.routes()
    group = None
    for r in routes:
        if r.get("type") == "group" and r.get("title") == group_name:
            group = r
            break

    if not group:
        print(f"  Group '{group_name}' not found")
        sys.exit(1)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    structure: dict[str, Any] = {
        "module": group_name,
        "icon": group.get("icon", "appstoreoutlined"),
        "pages": [],
    }
    state: dict[str, Any] = {
        "group_id": group["id"],
        "pages": {},
    }

    children = group.get("children", [])
    for child in children:
        if child.get("type") != "flowPage":
            continue
        title = child.get("title", "")
        tab_uid = _get_tab_uid(child)
        if not tab_uid:
            continue

        page_spec, page_state = _export_page(nb, title, child, tab_uid)
        structure["pages"].append(page_spec)
        state["pages"][_slugify(title)] = page_state
        print(f"  + {title} ({len(page_spec.get('blocks', []))} blocks)")

    (out / "structure.yaml").write_text(dump_yaml(structure))
    (out / "state.yaml").write_text(dump_yaml(state))
    print(f"\n  Exported to {out}/")


def sync_page(nb: NocoBase, page_name: str, out_dir: str):
    """Export a single page."""
    routes = nb.routes()
    page_route = _find_page(routes, page_name)
    if not page_route:
        print(f"  Page '{page_name}' not found")
        sys.exit(1)

    tab_uid = _get_tab_uid(page_route)
    if not tab_uid:
        print(f"  Page '{page_name}' has no tab")
        sys.exit(1)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    page_spec, page_state = _export_page(nb, page_name, page_route, tab_uid)

    structure = {
        "module": page_name,
        "pages": [page_spec],
    }
    state = {
        "pages": {_slugify(page_name): page_state},
    }

    (out / "structure.yaml").write_text(dump_yaml(structure))
    (out / "state.yaml").write_text(dump_yaml(state))
    print(f"\n  Exported to {out}/")


def _export_page(nb: NocoBase, title: str, route: dict,
                 tab_uid: str) -> tuple[dict, dict]:
    """Export a page to spec + state format via flowSurfaces:get."""
    try:
        page_data = nb.get(tabSchemaUid=tab_uid)
    except Exception:
        page_data = {}

    page_spec: dict[str, Any] = {
        "page": title,
        "icon": route.get("icon", "fileoutlined"),
        "blocks": [],
    }
    page_state: dict[str, Any] = {
        "route_id": route.get("id"),
        "page_uid": route.get("schemaUid"),
        "tab_uid": tab_uid,
        "blocks": {},
    }

    # flowSurfaces:get returns {tree, nodeMap, ...}
    tree = page_data.get("tree", {})
    node_map = page_data.get("nodeMap", {})

    # Navigate: tree → subModels.grid → subModels.items
    grid = tree.get("subModels", {}).get("grid", {})
    items = grid.get("subModels", {}).get("items", [])
    if not isinstance(items, list):
        items = [items] if items else []

    for item in items:
        if not isinstance(item, dict):
            continue
        block_spec, block_key = _parse_block(item)
        if block_spec:
            page_spec["blocks"].append(block_spec)
            page_state["blocks"][block_key] = {
                "uid": item.get("uid", ""),
                "type": block_spec.get("type", ""),
            }

    # Store grid UID
    if grid.get("uid"):
        page_state["grid_uid"] = grid["uid"]

    return page_spec, page_state


def _parse_block(item: dict) -> tuple[dict | None, str]:
    """Parse a FlowModel block node to spec format."""
    use = item.get("use", "")
    uid = item.get("uid", "")
    sp = item.get("stepParams", {})

    # Map model name to spec type
    type_map = {
        "TableBlockModel": "table",
        "FilterFormBlockModel": "filterForm",
        "CreateFormModel": "form",
        "EditFormModel": "editForm",
        "DetailsBlockModel": "detail",
        "ListBlockModel": "list",
        "JSBlockModel": "js",
        "GridCardBlockModel": "gridCard",
        "ChartBlockModel": "chart",
        "MarkdownBlockModel": "markdown",
    }

    btype = type_map.get(use)
    if not btype:
        return None, ""

    key = f"{btype}_{uid[:6]}"
    spec: dict[str, Any] = {"key": key, "type": btype}

    # Collection
    coll = sp.get("resourceSettings", {}).get("init", {}).get("collectionName", "")
    if coll:
        spec["coll"] = coll

    # Fields (from columns or grid items)
    subs = item.get("subModels", {})
    fields = _extract_fields_from_subs(subs, btype)
    if fields:
        spec["fields"] = fields

    # Actions
    actions = _extract_actions(subs.get("actions", []))
    if actions:
        spec["actions"] = actions

    return spec, key


def _extract_fields_from_subs(subs: dict, btype: str) -> list[str]:
    """Extract field paths from subModels."""
    fields = []

    # Table: columns → fieldSettings.init.fieldPath
    columns = subs.get("columns", [])
    if isinstance(columns, list):
        for col in columns:
            fp = (col.get("stepParams", {})
                   .get("fieldSettings", {})
                   .get("init", {})
                   .get("fieldPath", ""))
            if fp:
                fields.append(fp)

    # Filter/Form: grid → items → fieldSettings
    grid = subs.get("grid", {})
    if isinstance(grid, dict):
        grid_items = grid.get("subModels", {}).get("items", [])
        if isinstance(grid_items, list):
            for item in grid_items:
                fp = (item.get("stepParams", {})
                       .get("fieldSettings", {})
                       .get("init", {})
                       .get("fieldPath", ""))
                if fp:
                    fields.append(fp)

    return fields


def _extract_actions(actions: list) -> list[str]:
    """Extract action types from action nodes."""
    result = []
    # Map model names to semantic types
    action_map = {
        "FilterActionModel": "filter",
        "RefreshActionModel": "refresh",
        "AddNewActionModel": "addNew",
        "EditActionModel": "edit",
        "ViewActionModel": "view",
        "DeleteActionModel": "delete",
        "BulkDeleteActionModel": "bulkDelete",
        "ExportActionModel": "export",
        "ImportActionModel": "import",
        "LinkActionModel": "link",
        "FilterFormCollapseActionModel": "collapse",
        "FilterFormSubmitActionModel": "submit",
        "FilterFormResetActionModel": "reset",
    }
    if isinstance(actions, list):
        for act in actions:
            use = act.get("use", "")
            semantic = action_map.get(use, use.replace("Model", ""))
            result.append(semantic)
    return result


# ── Helpers ──────────────────────────────────────────────────────

def _get_tab_uid(route: dict) -> str | None:
    for ch in route.get("children", []):
        if ch.get("type") == "tabs" and ch.get("schemaUid"):
            return ch["schemaUid"]
    return None


def _find_page(routes: list, name: str) -> dict | None:
    for r in routes:
        if r.get("title") == name and r.get("type") == "flowPage":
            return r
        children = r.get("children", [])
        found = _find_page(children, name)
        if found:
            return found
    return None


def _print_routes(routes: list, depth: int = 0):
    for r in routes:
        indent = "  " * depth
        rtype = r.get("type", "?")
        title = r.get("title", "(no title)")
        print(f"  {indent}{rtype:10s} {title}")
        _print_routes(r.get("children", []), depth + 1)


def _slugify(title: str) -> str:
    import re
    s = title.strip().lower()
    s = re.sub(r'[^a-z0-9\u4e00-\u9fff]+', '-', s)
    return s.strip('-') or title


# ── CLI ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    nb = NocoBase()

    if len(sys.argv) < 2:
        sync_list(nb)
        sys.exit(0)

    name = sys.argv[1]

    if name == "--page":
        page_name = sys.argv[2] if len(sys.argv) > 2 else ""
        out_dir = sys.argv[3] if len(sys.argv) > 3 else f"./{_slugify(page_name)}"
        sync_page(nb, page_name, out_dir)
    else:
        out_dir = sys.argv[2] if len(sys.argv) > 2 else f"./{_slugify(name)}"
        sync_group(nb, name, out_dir)
