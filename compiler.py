"""DSL Compiler — functional spec → full FlowModel DSL.

Hides NocoBase internal model names. User writes what they want,
compiler expands to the correct model hierarchy.

Usage:
    from compiler import compile_spec
    full_dsl = compile_spec("task-board.spec.yaml")
    # → writes task-board.dsl.yaml with correct model names

Spec format:
    page: 任务看板
    coll: test_tasks           # default collection for all blocks
    blocks:
      - type: filter
        fields: [title, status]

      - type: table
        columns: [title, status, assignee, "due_date:date"]
        actions: [filter, refresh, addnew, bulkdelete]
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import yaml


# ── Field interface → model mapping ──────────────────────────────

# display models (for table columns, detail items)
DISPLAY_MODEL = {
    "text": "DisplayTextField",
    "enum": "DisplayEnumField",
    "date": "DisplayDateField",
    "datetime": "DisplayDateTimeField",
    "number": "DisplayNumberField",
    "image": "DisplayImageField",
    "tag": "DisplayTagField",
    "richtext": "DisplayRichTextField",
}

# edit models (for form fields, filter fields)
EDIT_MODEL = {
    "text": "InputField",
    "input": "InputField",
    "textarea": "TextareaField",
    "number": "IntegerField",
    "select": "SelectField",
    "enum": "SelectField",
    "multiselect": "MultipleSelectField",
    "date": "DateField",
    "datetime": "DateField",
    "checkbox": "CheckboxField",
    "radio": "RadioGroupField",
    "richtext": "RichTextField",
    "association": "AssociationSelectField",
    "attachment": "AttachmentField",
}

# action models per context
TABLE_ACTIONS = {
    "filter": "FilterAction",
    "refresh": "RefreshAction",
    "addnew": "AddNewAction",
    "bulkdelete": "BulkDeleteAction",
    "delete": "BulkDeleteAction",
    "export": "ExportAction",
    "import": "ImportAction",
    "edit": "EditAction",
    "js": "JSAction",
}

FILTER_ACTIONS = {
    "collapse": "FilterFormCollapseAction",
    "submit": "FilterFormSubmitAction",
    "reset": "FilterFormResetAction",
}

FORM_ACTIONS = {
    "submit": "SubmitAction",
    "cancel": "CancelAction",
    "js": "JSAction",
}


def gen_uid():
    import random, string
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=11))


# ── Compiler ─────────────────────────────────────────────────────

def compile_spec(spec_path: str, output_path: str = None) -> dict:
    """Compile a functional spec to a full DSL dict.

    Args:
        spec_path: Path to .spec.yaml
        output_path: Optional output .dsl.yaml path (default: replace .spec.yaml → .dsl.yaml)

    Returns:
        Full DSL dict
    """
    spec = yaml.safe_load(Path(spec_path).read_text())
    dsl = _compile(spec)

    if output_path is None:
        output_path = spec_path.replace(".spec.yaml", ".dsl.yaml")

    # Don't overwrite if dsl already exists with UIDs — merge instead
    out_path = Path(output_path)
    if out_path.exists():
        existing = yaml.safe_load(out_path.read_text())
        if existing and existing.get("tab"):
            # Existing DSL has UIDs — preserve route info
            dsl["tab"] = existing.get("tab")
            dsl["route"] = existing.get("route")
            dsl["page_uid"] = existing.get("page_uid")

    # Write using NoAliasDumper
    class NoAlias(yaml.SafeDumper):
        def ignore_aliases(self, data):
            return True

    out_path.write_text(yaml.dump(dsl, Dumper=NoAlias, allow_unicode=True,
                                   default_flow_style=False, sort_keys=False))
    print(f"  Compiled: {spec_path} → {output_path}")
    return dsl


def _compile(spec: dict) -> dict:
    """Convert spec to full DSL."""
    default_coll = spec.get("coll", "")
    blocks_spec = spec.get("blocks", [])

    # Build grid items
    items = []
    for bs in blocks_spec:
        btype = bs.get("type", "")
        coll = bs.get("coll", default_coll)

        if btype == "filter":
            items.append(_compile_filter(bs, coll))
        elif btype == "table":
            items.append(_compile_table(bs, coll))
        elif btype == "form":
            items.append(_compile_form(bs, coll))
        elif btype == "detail":
            items.append(_compile_detail(bs, coll))
        elif btype == "js":
            items.append(_compile_js(bs))
        else:
            # Pass through as-is (raw DSL)
            items.append(bs)

    dsl = {
        "page": spec.get("page", spec.get("title", "Untitled")),
        "tab": spec.get("tab"),
        "route": spec.get("route"),
        "grid": {
            "uid": None,
            "use": "BlockGrid",
            "items": items,
        },
    }

    if spec.get("group"):
        dsl["group_route_id"] = spec["group"]
    if spec.get("icon"):
        dsl["icon"] = spec["icon"]

    return dsl


# ── Block compilers ──────────────────────────────────────────────

def _compile_filter(bs: dict, coll: str) -> dict:
    """filter block → FilterFormBlock + FilterFormGrid + FilterFormItem..."""
    fields = _parse_fields(bs.get("fields", []))

    items = []
    for f in fields:
        edit_model = EDIT_MODEL.get(f["type"], "InputField")
        items.append({
            "uid": None,
            "use": "FilterFormItem",
            "field": {"uid": None, "use": edit_model},
            "stepParams": {
                "fieldSettings": {
                    "init": {
                        "collectionName": coll,
                        "fieldPath": f["name"],
                        "dataSourceKey": "main",
                    }
                }
            },
        })

    block: dict[str, Any] = {
        "uid": None,
        "use": "FilterFormBlock",
        "grid": {
            "uid": None,
            "use": "FilterFormGrid",
            "items": items,
        },
    }

    # Filter form actions (usually not needed, but support explicit)
    actions = bs.get("actions", [])
    if actions:
        block["actions"] = [
            {"uid": None, "use": FILTER_ACTIONS.get(a, a)}
            for a in actions
        ]

    return block


def _compile_table(bs: dict, coll: str) -> dict:
    """table block → TableBlock + TableColumn + Display..."""
    columns_spec = _parse_fields(bs.get("columns", []))

    columns = []
    for f in columns_spec:
        display_model = DISPLAY_MODEL.get(f["type"], "DisplayTextField")
        col: dict[str, Any] = {
            "uid": None,
            "use": "TableColumn",
            "field": {"uid": None, "use": display_model},
            "stepParams": {
                "fieldSettings": {
                    "init": {
                        "collectionName": coll,
                        "fieldPath": f["name"],
                        "dataSourceKey": "main",
                    }
                },
                "tableColumnSettings": {
                    "model": {"use": display_model + "Model"},
                },
            },
        }
        if f.get("click"):
            col["field"]["popup"] = [None, f["click"]]
            col["field"]["stepParams"] = {
                "displayFieldSettings": {"clickToOpen": {"clickToOpen": True}}
            }
        columns.append(col)

    block: dict[str, Any] = {
        "uid": None,
        "use": "TableBlock",
        "coll": coll,
        "columns": columns,
    }

    # Table actions
    actions = bs.get("actions", ["filter", "refresh", "addnew"])
    block["actions"] = [
        {"uid": None, "use": TABLE_ACTIONS.get(a, a)}
        for a in actions
    ]

    return block


def _compile_form(bs: dict, coll: str) -> dict:
    """form block → FormBlock + FormGrid + fields..."""
    fields = _parse_fields(bs.get("fields", []))

    form_fields = []
    for f in fields:
        edit_model = EDIT_MODEL.get(f["type"], "InputField")
        entry: dict[str, Any] = {
            "uid": None,
            "use": edit_model,
            "field": f["name"],
            "stepParams": {
                "fieldSettings": {
                    "init": {
                        "collectionName": coll,
                        "fieldPath": f["name"],
                        "dataSourceKey": "main",
                    }
                },
            },
        }
        if f.get("required"):
            entry["stepParams"]["editFieldSettings"] = {
                "required": {"required": True}
            }
        form_fields.append(entry)

    block: dict[str, Any] = {
        "uid": None,
        "use": "FormBlock",
        "coll": coll,
        "grid": {
            "uid": None,
            "use": "FormGrid",
            "fields": form_fields,
        },
    }

    actions = bs.get("actions", ["submit"])
    block["actions"] = [
        {"uid": None, "use": FORM_ACTIONS.get(a, a)}
        for a in actions
    ]

    return block


def _compile_detail(bs: dict, coll: str) -> dict:
    """detail block → DetailsBlock + DetailsGrid + DetailsItem..."""
    fields = _parse_fields(bs.get("fields", []))

    items = []
    for f in fields:
        display_model = DISPLAY_MODEL.get(f["type"], "DisplayTextField")
        items.append({
            "uid": None,
            "use": "DetailsItem",
            "field": {"uid": None, "use": display_model},
            "stepParams": {
                "fieldSettings": {
                    "init": {
                        "collectionName": coll,
                        "fieldPath": f["name"],
                        "dataSourceKey": "main",
                    }
                },
            },
        })

    return {
        "uid": None,
        "use": "DetailsBlock",
        "coll": coll,
        "grid": {
            "uid": None,
            "use": "DetailsGrid",
            "items": items,
        },
    }


def _compile_js(bs: dict) -> dict:
    """js block → JSBlock with inline or file code."""
    code = bs.get("code", "")
    code_file = bs.get("file", "")

    if code_file and not code:
        p = Path(code_file)
        if p.exists():
            code = p.read_text()
        else:
            code = f"// TODO: load from {code_file}"

    return {
        "uid": None,
        "use": "JSBlock",
        "stepParams": {
            "jsSettings": {"runJs": {"code": code}},
        },
    }


# ── Field parser ─────────────────────────────────────────────────

def _parse_fields(fields: list) -> list[dict]:
    """Parse field specs. Supports multiple formats:

    Simple:     "title"              → {name: "title", type: "text"}
    Typed:      "due_date:date"      → {name: "due_date", type: "date"}
    Required:   "title*"             → {name: "title", type: "text", required: True}
    Clickable:  "name>embed"         → {name: "name", type: "text", click: "embed"}
    Dict:       {field: "x", type: "enum"}  → as-is
    """
    result = []
    for f in fields:
        if isinstance(f, dict):
            entry = {
                "name": f.get("field", f.get("name", "")),
                "type": f.get("type", f.get("display", "text")),
            }
            if f.get("required"):
                entry["required"] = True
            if f.get("click"):
                entry["click"] = f["click"]
            result.append(entry)
            continue

        # String format
        s = str(f).strip()
        entry: dict[str, Any] = {"type": "text"}

        # Check for click: "name>embed"
        if ">" in s:
            s, click = s.split(">", 1)
            entry["click"] = click.strip()

        # Check for type: "due_date:date"
        if ":" in s:
            s, ftype = s.split(":", 1)
            entry["type"] = ftype.strip()

        # Check for required: "title*"
        if s.endswith("*"):
            s = s[:-1]
            entry["required"] = True

        entry["name"] = s.strip()
        result.append(entry)

    return result


# ── CLI ──────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    spec_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    compile_spec(spec_path, output_path)


if __name__ == "__main__":
    main()
