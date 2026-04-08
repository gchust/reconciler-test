"""Page exporter — extract complete page structure from live NocoBase.

Treats pages and popups identically (both are "surfaces" with tabs + blocks).
Exports everything needed for 1:1 replication:
  - Block structure (type, collection, title)
  - Fields with layout (row/col positions)
  - JS code → external files with desc from comments
  - Actions + recordActions
  - Popup references (uid-based, not inlined)
  - Resource bindings (filterByTk, association, etc.)

Usage:
    from exporter import export_page_surface
    spec = export_page_surface(nb, tab_uid, js_dir=Path("./js"))
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from nb import NocoBase


def export_page_surface(nb: NocoBase, tab_uid: str,
                        js_dir: Path = None,
                        page_key: str = "page") -> dict:
    """Export a complete page/popup surface.

    Returns a spec dict matching enhance.yaml popup format:
      {blocks: [...], layout: [...]}
    """
    data = nb.get(tabSchemaUid=tab_uid)
    tree = data.get("tree", {})
    grid = tree.get("subModels", {}).get("grid", {})

    return _export_grid(nb, grid, js_dir, page_key, reset_keys=True)


def export_popup_surface(nb: NocoBase, field_uid: str,
                         js_dir: Path = None,
                         popup_key: str = "popup") -> dict | None:
    """Export a popup surface from a field/action that has a ChildPageModel."""
    data = nb.get(uid=field_uid)
    tree = data.get("tree", {})
    popup = tree.get("subModels", {}).get("page", {})
    if not popup:
        return None

    # Popup mode
    mode = tree.get("stepParams", {}).get("popupSettings", {}).get("openView", {}).get("mode", "drawer")

    tabs = popup.get("subModels", {}).get("tabs", [])
    if not isinstance(tabs, list):
        tabs = [tabs] if tabs else []

    if len(tabs) <= 1:
        # Single tab — export as flat blocks
        if tabs:
            grid = tabs[0].get("subModels", {}).get("grid", {})
            result = _export_grid(nb, grid, js_dir, popup_key)
        else:
            result = {"blocks": []}
        result["mode"] = mode
        return result

    # Multi-tab
    result: dict[str, Any] = {"mode": mode, "tabs": []}
    for i, tab in enumerate(tabs):
        tab_title = (tab.get("props", {}).get("title")
                     or tab.get("stepParams", {}).get("pageTabSettings", {}).get("title", {}).get("title")
                     or f"Tab{i}")
        grid = tab.get("subModels", {}).get("grid", {})
        tab_spec = _export_grid(nb, grid, js_dir, f"{popup_key}_tab{i}")
        tab_spec["title"] = tab_title
        result["tabs"].append(tab_spec)

    return result


def _export_grid(nb: NocoBase, grid: dict, js_dir: Path = None,
                 prefix: str = "", reset_keys: bool = False) -> dict:
    """Export a BlockGridModel and its contents."""
    global _used_keys
    if not isinstance(grid, dict):
        return {"blocks": [], "layout": []}

    if reset_keys:
        _used_keys = set()

    grid_uid = grid.get("uid", "")
    items = grid.get("subModels", {}).get("items", [])
    if not isinstance(items, list):
        items = [items] if items else []

    blocks = []
    block_uid_to_key: dict[str, str] = {}
    popup_refs: list[dict] = []
    state_blocks: dict[str, Any] = {}

    for i, item in enumerate(items):
        block_spec, block_key, block_state = _export_block(nb, item, js_dir, prefix, i)
        if block_spec:
            blocks.append(block_spec)
            block_uid_to_key[item.get("uid", "")] = block_key
            state_blocks[block_key] = block_state

            # Collect popup references from fields
            popups = block_spec.pop("_popups", [])
            popup_refs.extend(popups)

    # Extract page-level layout
    layout = _export_layout(grid, block_uid_to_key)

    result: dict[str, Any] = {"blocks": blocks}
    if layout:
        result["layout"] = layout
    if popup_refs:
        result["popups"] = popup_refs
    # State: UID registry (separate from spec)
    result["_state"] = {"grid_uid": grid_uid, "blocks": state_blocks}

    return result


_used_keys: set[str] = set()


def _export_block(nb: NocoBase, item: dict, js_dir: Path = None,
                  prefix: str = "", index: int = 0) -> tuple[dict | None, str, dict]:
    """Export a single block node."""
    use = item.get("use", "")
    uid = item.get("uid", "")
    sp = item.get("stepParams", {})
    subs = item.get("subModels", {})

    type_map = {
        "TableBlockModel": "table",
        "FilterFormBlockModel": "filterForm",
        "CreateFormModel": "createForm",
        "EditFormModel": "editForm",
        "DetailsBlockModel": "details",
        "ListBlockModel": "list",
        "JSBlockModel": "jsBlock",
        "GridCardBlockModel": "gridCard",
        "ChartBlockModel": "chart",
        "MarkdownBlockModel": "markdown",
        "CommentsBlockModel": "comments",
        "RecordHistoryBlockModel": "recordHistory",
        "IframeBlockModel": "iframe",
    }

    btype = type_map.get(use)
    if not btype:
        return None, "", {}

    # Block title
    title = sp.get("cardSettings", {}).get("titleDescription", {}).get("title", "")

    # Generate semantic key: title > JS desc > type+index
    if title:
        key = _slugify(title)
    elif btype == "jsBlock":
        code = sp.get("jsSettings", {}).get("runJs", {}).get("code", "")
        desc = _extract_js_desc(code)
        key = _slugify(desc) if desc else f"{btype}_{index}"
    else:
        key = f"{btype}_{index}"

    # Deduplicate key within same page
    base_key = key
    counter = 2
    while key in _used_keys:
        key = f"{base_key}_{counter}"
        counter += 1
    _used_keys.add(key)

    spec: dict[str, Any] = {"key": key, "type": btype}
    if title:
        spec["title"] = title

    # Collection + resource binding
    res = sp.get("resourceSettings", {}).get("init", {})
    coll = res.get("collectionName", "")
    if coll:
        spec["coll"] = coll
    # Full resource binding (for popup blocks)
    binding = {}
    if res.get("filterByTk"):
        binding["filterByTk"] = res["filterByTk"]
    if res.get("associationName"):
        binding["associationName"] = res["associationName"]
    if res.get("sourceId"):
        binding["sourceId"] = res["sourceId"]
    if binding:
        spec["resource_binding"] = binding

    # ── Type-specific extraction ──
    popup_refs = []

    if btype == "jsBlock":
        code = sp.get("jsSettings", {}).get("runJs", {}).get("code", "")
        if code:
            desc = _extract_js_desc(code)
            if desc:
                spec["desc"] = desc
            if js_dir:
                fname = f"{prefix}_{key}.js" if prefix else f"{key}.js"
                (js_dir / fname).write_text(code)
                spec["file"] = f"./js/{fname}"

    elif btype == "chart":
        config = sp.get("chartSettings", {}).get("configure", {})
        if config and js_dir:
            import json
            fname = f"{prefix}_{key}.json" if prefix else f"{key}.json"
            chart_dir = js_dir.parent / "charts"
            chart_dir.mkdir(exist_ok=True)
            (chart_dir / fname).write_text(json.dumps(config, indent=2, ensure_ascii=False))
            spec["chart_config"] = f"./charts/{fname}"

    elif btype == "table":
        fields, js_cols, field_popups = _export_table_contents(item, js_dir, prefix, key)
        if fields:
            spec["fields"] = fields
        if js_cols:
            spec["js_columns"] = js_cols
        popup_refs.extend(field_popups)

        # Actions
        actions = _export_actions(subs.get("actions", []))
        if actions:
            spec["actions"] = actions
        rec_actions = _export_record_actions(subs)
        if rec_actions:
            spec["recordActions"] = rec_actions

    elif btype in ("filterForm", "createForm", "editForm", "details"):
        grid = subs.get("grid", {})
        if isinstance(grid, dict):
            fields, js_items, layout, field_popups = _export_form_contents(
                grid, js_dir, prefix, key)
            if fields:
                spec["fields"] = fields
            if js_items:
                spec["js_items"] = js_items
            if layout:
                spec["field_layout"] = layout
            popup_refs.extend(field_popups)

        # Actions
        actions = _export_actions(subs.get("actions", []))
        if actions:
            spec["actions"] = actions
        rec_actions = _export_actions(subs.get("recordActions", []))
        if rec_actions:
            spec["recordActions"] = rec_actions

    elif btype == "list":
        # List block — extract ListItem children (fields, JS items, actions)
        list_item = subs.get("item", {})
        if isinstance(list_item, dict) and list_item.get("use"):
            li_grid = list_item.get("subModels", {}).get("grid", {})
            if isinstance(li_grid, dict):
                li_fields, li_js, li_layout, li_popups = _export_form_contents(
                    li_grid, js_dir, prefix, key)
                if li_fields:
                    spec["item_fields"] = li_fields
                if li_js:
                    spec["item_js"] = li_js
                if li_layout:
                    spec["item_layout"] = li_layout
                popup_refs.extend(li_popups)

            # ListItem actions (e.g., EditAction with popup)
            li_actions = _export_actions(list_item.get("subModels", {}).get("actions", []))
            if li_actions:
                spec["item_actions"] = li_actions

        # Block-level actions
        actions = _export_actions(subs.get("actions", []))
        if actions:
            spec["actions"] = actions

    elif btype == "comments":
        # Comments block — preserve association binding
        # Actions
        actions = _export_actions(subs.get("actions", []))
        if actions:
            spec["actions"] = actions

    if popup_refs:
        spec["_popups"] = popup_refs

    # Build state for this block
    block_state: dict[str, Any] = {"uid": uid, "type": btype}
    if title:
        block_state["title"] = title

    return spec, key, block_state


# ── Table contents ────────────────────────────────────────────────

def _export_table_contents(item: dict, js_dir: Path = None,
                            prefix: str = "", block_key: str = ""
                            ) -> tuple[list, list, list]:
    """Extract fields, JS columns, and popup refs from table."""
    fields = []
    js_cols = []
    popup_refs = []

    columns = item.get("subModels", {}).get("columns", [])
    if not isinstance(columns, list):
        return fields, js_cols, popup_refs

    for col in columns:
        col_use = col.get("use", "")

        if col_use == "JSColumnModel":
            code = col.get("stepParams", {}).get("jsSettings", {}).get("runJs", {}).get("code", "")
            col_title = col.get("stepParams", {}).get("tableColumnSettings", {}).get("title", {}).get("title", "")
            desc = _extract_js_desc(code) if code else ""
            entry: dict[str, Any] = {}
            if col_title:
                entry["title"] = col_title
            if desc:
                entry["desc"] = desc
            if code and js_dir:
                safe = _slugify(col_title or desc or f"col_{len(js_cols)}")
                fname = f"{prefix}_{block_key}_col_{safe}.js"
                (js_dir / fname).write_text(code)
                entry["file"] = f"./js/{fname}"
            js_cols.append(entry)

        elif col_use == "TableActionsColumnModel":
            continue  # handled by _export_record_actions

        else:
            fp = col.get("stepParams", {}).get("fieldSettings", {}).get("init", {}).get("fieldPath", "")
            if fp:
                fields.append(fp)

            # Check for popup on this column's display field
            field = col.get("subModels", {}).get("field", {})
            if isinstance(field, dict):
                popup_page = field.get("subModels", {}).get("page", {})
                if popup_page and popup_page.get("uid"):
                    ov = field.get("stepParams", {}).get("popupSettings", {}).get("openView", {})
                    popup_refs.append({
                        "field": fp,
                        "field_uid": field.get("uid", ""),
                        "mode": ov.get("mode", "drawer"),
                        "popup_page_uid": popup_page.get("uid", ""),
                    })

    return fields, js_cols, popup_refs


# ── Form/Detail/Filter contents ──────────────────────────────────

def _export_form_contents(grid: dict, js_dir: Path = None,
                           prefix: str = "", block_key: str = ""
                           ) -> tuple[list, list, list | None, list]:
    """Extract fields, JS items, layout, and popup refs from a form/detail grid."""
    fields = []
    js_items = []
    popup_refs = []

    grid_uid = grid.get("uid", "")
    items = grid.get("subModels", {}).get("items", [])
    if not isinstance(items, list):
        return fields, js_items, None, popup_refs

    # Build uid → name map for layout
    uid_to_name: dict[str, str] = {}

    for di in items:
        di_use = di.get("use", "")
        di_uid = di.get("uid", "")

        if "JSItem" in di_use:
            code = di.get("stepParams", {}).get("jsSettings", {}).get("runJs", {}).get("code", "")
            desc = _extract_js_desc(code) if code else ""
            entry: dict[str, Any] = {}
            if desc:
                entry["desc"] = desc
            js_name = _slugify(desc) if desc else f"js_{len(js_items)}"
            if code and js_dir:
                fname = f"{prefix}_{block_key}_{js_name}.js"
                (js_dir / fname).write_text(code)
                entry["file"] = f"./js/{fname}"
            js_items.append(entry)
            # Full desc in layout reference (not truncated)
            uid_to_name[di_uid] = f"[JS:{desc}]" if desc else "[JS]"

        elif "DividerItem" in di_use or "MarkdownItem" in di_use:
            label = di.get("stepParams", {}).get("markdownItemSetting", {}).get("title", {}).get("label", "")
            uid_to_name[di_uid] = f"--- {label} ---" if label else "---"

        else:
            fp = di.get("stepParams", {}).get("fieldSettings", {}).get("init", {}).get("fieldPath", "")
            if fp:
                fields.append(fp)
                uid_to_name[di_uid] = fp

    # Extract layout from gridSettings
    layout = _extract_layout(grid, uid_to_name)

    return fields, js_items, layout, popup_refs


# ── Layout extraction ─────────────────────────────────────────────

def _extract_layout(grid: dict, uid_to_name: dict[str, str]) -> list | None:
    """Convert gridSettings.rows back to layout DSL."""
    gs = grid.get("stepParams", {}).get("gridSettings", {}).get("grid", {})
    rows = gs.get("rows", {})
    sizes = gs.get("sizes", {})
    row_order = gs.get("rowOrder", list(rows.keys()))

    if not rows:
        return None

    layout = []
    for rk in row_order:
        cols = rows.get(rk, [])
        sz = sizes.get(rk, [])
        n_cols = len(cols)

        # Check if all cols are single item and equal size → simple row
        all_single = all(len(col) == 1 for col in cols)
        equal_size = len(set(sz)) <= 1 if sz else True
        default_size = 24 // n_cols if n_cols else 24

        if n_cols == 1 and len(cols[0]) == 1:
            # Single item row
            name = uid_to_name.get(cols[0][0], cols[0][0][:8])
            if name.startswith("--- "):
                layout.append(name)  # divider
            else:
                layout.append([name])

        elif all_single and equal_size and all(s == default_size for s in sz):
            # Simple equal-width row
            names = [uid_to_name.get(col[0], col[0][:8]) for col in cols]
            layout.append(names)

        else:
            # Complex row (different sizes or stacked items)
            row_items = []
            for j, col in enumerate(cols):
                s = sz[j] if j < len(sz) else default_size
                names = [uid_to_name.get(u, u[:8]) for u in col]

                if len(names) == 1:
                    if s == default_size and equal_size:
                        row_items.append(names[0])
                    else:
                        row_items.append({names[0]: s})
                else:
                    # Stacked column
                    row_items.append({"col": names, "size": s})

            layout.append(row_items)

    return layout if layout else None


def _export_layout(grid: dict, uid_to_key: dict[str, str]) -> list | None:
    """Export page-level block layout."""
    return _extract_layout(grid, uid_to_key)


# ── Actions ───────────────────────────────────────────────────────

ACTION_MAP = {
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
    "FormSubmitActionModel": "submit",
    "FilterFormCollapseActionModel": "collapse",
    "FilterFormSubmitActionModel": "submit",
    "FilterFormResetActionModel": "reset",
    "PopupCollectionActionModel": "popup",
    "ExpandCollapseActionModel": "expandCollapse",
    "UpdateRecordActionModel": "updateRecord",
    "DuplicateActionModel": "duplicate",
    "CollectionTriggerWorkflowActionModel": "workflowTrigger",
    "AIEmployeeButtonModel": "ai",
    "RecordHistoryExpandActionModel": "historyExpand",
    "RecordHistoryCollapseActionModel": "historyCollapse",
}


def _export_actions(actions) -> list[str]:
    if not isinstance(actions, list):
        return []
    result = []
    for act in actions:
        use = act.get("use", "")
        if "TableActionsColumn" in use:
            continue
        semantic = ACTION_MAP.get(use, use.replace("Model", ""))
        result.append(semantic)
    return result


def _export_record_actions(subs: dict) -> list[str]:
    for col in subs.get("columns", []):
        if "TableActionsColumn" in col.get("use", ""):
            acts = col.get("subModels", {}).get("actions", [])
            return _export_actions(acts)
    return []


# ── Helpers ───────────────────────────────────────────────────────

def _extract_js_desc(code: str) -> str:
    """Extract description from JS code comment header."""
    for line in code.split("\n"):
        line = line.strip()
        if line.startswith("*") and len(line) > 3 and not line.startswith("*/"):
            desc = line.lstrip("* ").strip()
            if desc and not desc.startswith("@") and not desc.startswith("Table:"):
                return desc
    return ""


def _slugify(s: str) -> str:
    import re
    s = s.strip().lower()
    s = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "_", s)
    return s.strip("_") or "item"
