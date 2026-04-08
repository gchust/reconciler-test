"""DSL Compiler — functional spec → full FlowModel DSL.

Hides NocoBase internal model names. User/AI writes what they want,
compiler expands to the correct model hierarchy with validation.

Usage:
    python compiler.py task-board.spec.yaml              # compile to .dsl.yaml
    python compiler.py task-board.spec.yaml --validate    # validate only, no output

Spec format:
    page: 任务看板
    coll: test_tasks
    blocks:
      - type: filter
        fields: [title, status]

      - type: table
        columns: [title, status, assignee, "due_date:date"]
        actions: [filter, refresh, addnew, bulkdelete]

Field DSL:
    "title"          → text input
    "status:enum"    → enum/select display
    "due_date:date"  → date display
    "title*"         → required
    "name>embed"     → click to open (embed mode)
    "name>drawer"    → click to open (drawer mode)
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import yaml


# ══════════════════════════════════════════════════════════════════
#  Registry — from NocoBase source code
# ══════════════════════════════════════════════════════════════════

# ── Block types ──────────────────────────────────────────────────

BLOCK_TYPES = {
    "table":   {"use": "TableBlock",      "grid": None,              "item": "TableColumn",     "item_key": "columns"},
    "filter":  {"use": "FilterFormBlock", "grid": "FilterFormGrid",  "item": "FilterFormItem",  "item_key": "items"},
    "form":    {"use": "CreateForm",      "grid": "FormGrid",        "item": "FormItem",        "item_key": "items"},
    "edit":    {"use": "EditForm",        "grid": "FormGrid",        "item": "FormItem",        "item_key": "items"},
    "detail":  {"use": "DetailsBlock",    "grid": "DetailsGrid",     "item": "DetailsItem",     "item_key": "items"},
    "list":    {"use": "ListBlock",       "grid": None,              "item": None,              "item_key": None},
    "js":      {"use": "JSBlock",         "grid": None,              "item": None,              "item_key": None},
}

# ── Action registry (alias → model name) per block context ──────
# Source: packages/core/client/src/flow/models/actions/
#         packages/core/client/src/flow/models/blocks/*/

ACTIONS = {
    # Table / List block actions
    "table": {
        "filter":       "FilterAction",
        "refresh":      "RefreshAction",
        "addnew":       "AddNewAction",
        "add":          "AddNewAction",
        "edit":         "EditAction",
        "view":         "ViewAction",
        "delete":       "DeleteAction",
        "bulkdelete":   "BulkDeleteAction",
        "bulkupdate":   "BulkUpdateAction",
        "bulkedit":     "BulkEditAction",
        "export":       "ExportAction",
        "import":       "ImportAction",
        "link":         "LinkAction",
        "expand":       "ExpandCollapseAction",
        "duplicate":    "DuplicateAction",
        "update":       "UpdateRecordAction",
        "addchild":     "AddChildAction",
        "customrequest":"CustomRequestAction",
        "popup":        "PopupCollectionAction",
        "js":           "JSCollectionAction",
        "js:record":    "JSRecordAction",
        "js:item":      "JSItemAction",
        "ai":           "AIEmployeeButton",
    },
    # Filter form actions
    "filter": {
        "collapse":     "FilterFormCollapseAction",
        "submit":       "FilterFormSubmitAction",
        "reset":        "FilterFormResetAction",
        "js":           "FilterFormJSAction",
    },
    # Form (create/edit) actions
    "form": {
        "submit":       "FormSubmitAction",
        "js":           "JSFormAction",
    },
    "edit": {
        "submit":       "FormSubmitAction",
        "js":           "JSFormAction",
    },
    # Detail block actions
    "detail": {
        "edit":         "EditAction",
        "delete":       "DeleteAction",
        "duplicate":    "DuplicateAction",
        "popup":        "PopupCollectionAction",
        "js":           "JSRecordAction",
        "ai":           "AIEmployeeButton",
    },
}

# ── Display field models (for table columns, detail items) ───────
# Source: packages/core/client/src/flow/models/fields/
#         + DISPLAY_MAP in models.py

DISPLAY = {
    "text":      "DisplayTextField",
    "input":     "DisplayTextField",
    "string":    "DisplayTextField",
    "enum":      "DisplayEnumField",
    "select":    "DisplayEnumField",
    "checkbox":  "DisplayCheckboxField",
    "number":    "DisplayNumberField",
    "integer":   "DisplayNumberField",
    "percent":   "DisplayPercentField",
    "date":      "DisplayDateTimeField",
    "datetime":  "DisplayDateTimeField",
    "time":      "DisplayTimeField",
    "color":     "DisplayColorField",
    "icon":      "DisplayIconField",
    "url":       "DisplayURLField",
    "html":      "DisplayHtmlField",
    "richtext":  "DisplayHtmlField",
    "json":      "DisplayJSONField",
    "password":  "DisplayPasswordField",
    "title":     "DisplayTitleField",
    "tag":       "DisplayEnumField",       # multiselect renders as tags
    "subtable":  "DisplaySubTableField",
    "sublist":   "DisplaySubListField",
    "subitem":   "DisplaySubItemField",
}

# ── Edit field models (for form fields, filter fields) ───────────
# Source: packages/core/client/src/flow/models/fields/

EDIT = {
    "text":        "InputField",
    "input":       "InputField",
    "string":      "InputField",
    "textarea":    "TextareaField",
    "number":      "NumberField",
    "integer":     "NumberField",
    "percent":     "NumberField",
    "select":      "SelectField",
    "enum":        "SelectField",
    "multiselect": "MultipleSelectField",
    "radio":       "RadioGroupField",
    "checkbox":    "CheckboxField",
    "checkboxgroup":"CheckboxGroupField",
    "date":        "DateOnlyField",
    "datetime":    "DateTimeTzField",
    "time":        "TimeField",
    "color":       "InputField",
    "url":         "InputField",
    "richtext":    "InputField",
    "json":        "InputField",
    "association": "RecordSelectField",
    "m2o":         "RecordSelectField",
    "attachment":  "AttachmentField",
}


# ══════════════════════════════════════════════════════════════════
#  Validation
# ══════════════════════════════════════════════════════════════════

class ValidationError:
    def __init__(self, level: str, path: str, msg: str, hint: str = ""):
        self.level = level  # "error" | "warn" | "info"
        self.path = path
        self.msg = msg
        self.hint = hint

    def __str__(self):
        icon = {"error": "✗", "warn": "⚠", "info": "·"}[self.level]
        s = f"  {icon} {self.path}: {self.msg}"
        if self.hint:
            s += f"\n    → {self.hint}"
        return s


def validate_spec(spec: dict) -> list[ValidationError]:
    """Validate a spec before compilation."""
    errors: list[ValidationError] = []

    # Page title
    if not spec.get("page") and not spec.get("title"):
        errors.append(ValidationError("error", "page", "Missing page title"))

    # Collection
    default_coll = spec.get("coll", "")

    # Blocks
    blocks = spec.get("blocks", [])
    if not blocks:
        errors.append(ValidationError("warn", "blocks", "No blocks defined"))

    for i, bs in enumerate(blocks):
        bpath = f"blocks[{i}]"
        btype = bs.get("type", "")

        # Block type check
        if btype not in BLOCK_TYPES:
            known = ", ".join(sorted(BLOCK_TYPES.keys()))
            errors.append(ValidationError(
                "error", bpath,
                f"Unknown block type '{btype}'",
                f"Available: {known}"))
            continue

        # Collection check
        coll = bs.get("coll", default_coll)
        if btype in ("table", "form", "edit", "detail") and not coll:
            errors.append(ValidationError(
                "error", bpath,
                f"'{btype}' block requires a collection",
                "Set 'coll' on the block or at top level"))

        # Filter doesn't bind to collection directly
        if btype == "filter" and bs.get("coll"):
            errors.append(ValidationError(
                "info", bpath,
                "Filter block's collection is inherited from connected table block",
                "The 'coll' here is used for field resolution, not for data binding"))

        # Actions check
        actions = bs.get("actions", [])
        allowed = ACTIONS.get(btype, {})
        for j, act in enumerate(actions):
            apath = f"{bpath}.actions[{j}]"
            act_name = act if isinstance(act, str) else act.get("type", "")

            if act_name and act_name not in allowed:
                avail = ", ".join(sorted(allowed.keys()))
                # Check if it belongs to a different block type
                wrong_ctx = _find_action_context(act_name)
                hint = f"Available for '{btype}': {avail}"
                if wrong_ctx:
                    hint += f"\n    → '{act_name}' belongs to '{wrong_ctx}' blocks, not '{btype}'"
                errors.append(ValidationError("error", apath,
                    f"Action '{act_name}' not allowed in '{btype}' block", hint))

        # Fields/columns check
        fields_key = "columns" if btype == "table" else "fields"
        fields = bs.get(fields_key, [])
        if btype in ("table", "filter") and not fields:
            errors.append(ValidationError(
                "warn", bpath,
                f"'{btype}' block has no {fields_key}",
                "Add fields/columns or the block will be empty"))

        # Field type check
        for j, f in enumerate(fields):
            fpath = f"{bpath}.{fields_key}[{j}]"
            parsed = _parse_field(f)
            ftype = parsed.get("type", "text")

            if btype == "table":
                if ftype not in DISPLAY:
                    avail = ", ".join(sorted(set(DISPLAY.keys())))
                    errors.append(ValidationError("warn", fpath,
                        f"Unknown display type '{ftype}', will use 'text'",
                        f"Available: {avail}"))
            elif btype in ("filter", "form", "edit"):
                if ftype not in EDIT:
                    avail = ", ".join(sorted(set(EDIT.keys())))
                    errors.append(ValidationError("warn", fpath,
                        f"Unknown edit type '{ftype}', will use 'input'",
                        f"Available: {avail}"))

        # JS block check
        if btype == "js" and not bs.get("code") and not bs.get("file"):
            errors.append(ValidationError(
                "warn", bpath,
                "JS block has no code or file",
                "Set 'code' (inline) or 'file' (path to .js file)"))

    return errors


def _find_action_context(action_name: str) -> str | None:
    """Find which block type an action belongs to (for better error messages)."""
    for ctx, acts in ACTIONS.items():
        if action_name in acts:
            return ctx
    return None


# ══════════════════════════════════════════════════════════════════
#  Compiler
# ══════════════════════════════════════════════════════════════════

def gen_uid():
    import random, string
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=11))


def compile_spec(spec_path: str, output_path: str = None,
                 validate_only: bool = False) -> dict | None:
    """Compile a functional spec to a full DSL dict.

    Returns compiled DSL dict, or None if validation failed.
    """
    spec = yaml.safe_load(Path(spec_path).read_text())

    # Validate
    errors = validate_spec(spec)
    if errors:
        has_errors = any(e.level == "error" for e in errors)
        print(f"\n  Validation {'failed' if has_errors else 'passed with warnings'}:")
        for e in errors:
            print(e)
        if has_errors:
            print(f"\n  Fix errors above before compiling.")
            return None
        print()

    if validate_only:
        if not errors:
            print("  Validation passed.")
        return None

    # Compile
    dsl = _compile(spec)

    if output_path is None:
        output_path = spec_path.replace(".spec.yaml", ".dsl.yaml")

    # Preserve existing UIDs if DSL file already exists
    out_path = Path(output_path)
    if out_path.exists():
        existing = yaml.safe_load(out_path.read_text())
        if existing and existing.get("tab"):
            dsl["tab"] = existing.get("tab")
            dsl["route"] = existing.get("route")
            dsl["page_uid"] = existing.get("page_uid")

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

    items = []
    for bs in spec.get("blocks", []):
        btype = bs.get("type", "")
        coll = bs.get("coll", default_coll)
        handler = _BLOCK_COMPILERS.get(btype)
        if handler:
            items.append(handler(bs, coll))
        else:
            items.append(bs)

    dsl: dict[str, Any] = {
        "page": spec.get("page", spec.get("title", "Untitled")),
        "tab": spec.get("tab"),
        "route": spec.get("route"),
        "grid": {"uid": None, "use": "BlockGrid", "items": items},
    }
    if spec.get("group"):
        dsl["group_route_id"] = spec["group"]
    if spec.get("icon"):
        dsl["icon"] = spec["icon"]
    return dsl


# ── Block compilers ──────────────────────────────────────────────

def _compile_filter(bs: dict, coll: str) -> dict:
    """filter → FilterFormBlock + FilterFormGrid + FilterFormItem..."""
    fields = _parse_fields(bs.get("fields", []))

    items = []
    for f in fields:
        edit = EDIT.get(f["type"], "InputField")
        items.append({
            "uid": None, "use": "FilterFormItem",
            "field": {"uid": None, "use": edit},
            "stepParams": {"fieldSettings": {"init": {
                "collectionName": coll, "fieldPath": f["name"],
                "dataSourceKey": "main"}}},
        })

    block: dict[str, Any] = {
        "uid": None, "use": "FilterFormBlock",
        "grid": {"uid": None, "use": "FilterFormGrid", "items": items},
    }

    actions = bs.get("actions", [])
    if actions:
        block["actions"] = _compile_actions(actions, "filter")

    return block


def _compile_table(bs: dict, coll: str) -> dict:
    """table → TableBlock + TableColumn + Display..."""
    columns_spec = _parse_fields(bs.get("columns", []))

    columns = []
    for f in columns_spec:
        display = DISPLAY.get(f["type"], "DisplayTextField")
        col: dict[str, Any] = {
            "uid": None, "use": "TableColumn",
            "field": {"uid": None, "use": display},
            "stepParams": {
                "fieldSettings": {"init": {
                    "collectionName": coll, "fieldPath": f["name"],
                    "dataSourceKey": "main"}},
                "tableColumnSettings": {"model": {"use": display + "Model"}},
            },
        }
        if f.get("click"):
            col["field"]["popup"] = [None, f["click"]]
            col["field"]["stepParams"] = {
                "displayFieldSettings": {"clickToOpen": {"clickToOpen": True}}
            }
        columns.append(col)

    block: dict[str, Any] = {
        "uid": None, "use": "TableBlock", "coll": coll,
        "columns": columns,
        "actions": _compile_actions(
            bs.get("actions", ["filter", "refresh", "addnew"]), "table"),
    }
    return block


def _compile_form(bs: dict, coll: str) -> dict:
    """form → CreateForm + FormGrid + FormItem..."""
    fields = _parse_fields(bs.get("fields", []))

    items = []
    for f in fields:
        edit = EDIT.get(f["type"], "InputField")
        entry: dict[str, Any] = {
            "uid": None, "use": "FormItem",
            "field": {"uid": None, "use": edit},
            "stepParams": {"fieldSettings": {"init": {
                "collectionName": coll, "fieldPath": f["name"],
                "dataSourceKey": "main"}}},
        }
        if f.get("required"):
            entry["stepParams"]["editFieldSettings"] = {
                "required": {"required": True}}
        items.append(entry)

    block: dict[str, Any] = {
        "uid": None, "use": "CreateForm", "coll": coll,
        "grid": {"uid": None, "use": "FormGrid", "items": items},
        "actions": _compile_actions(
            bs.get("actions", ["submit"]), "form"),
    }
    return block


def _compile_edit(bs: dict, coll: str) -> dict:
    """edit form — same as form but uses EditForm."""
    block = _compile_form(bs, coll)
    block["use"] = "EditForm"
    return block


def _compile_detail(bs: dict, coll: str) -> dict:
    """detail → DetailsBlock + DetailsGrid + DetailsItem..."""
    fields = _parse_fields(bs.get("fields", []))

    items = []
    for f in fields:
        display = DISPLAY.get(f["type"], "DisplayTextField")
        items.append({
            "uid": None, "use": "DetailsItem",
            "field": {"uid": None, "use": display},
            "stepParams": {"fieldSettings": {"init": {
                "collectionName": coll, "fieldPath": f["name"],
                "dataSourceKey": "main"}}},
        })

    block: dict[str, Any] = {
        "uid": None, "use": "DetailsBlock", "coll": coll,
        "grid": {"uid": None, "use": "DetailsGrid", "items": items},
    }
    actions = bs.get("actions", [])
    if actions:
        block["actions"] = _compile_actions(actions, "detail")
    return block


def _compile_js(bs: dict, coll: str = "") -> dict:
    """js → JSBlock with code or file."""
    code = bs.get("code", "")
    if bs.get("file") and not code:
        p = Path(bs["file"])
        code = p.read_text() if p.exists() else f"// TODO: load from {bs['file']}"

    return {
        "uid": None, "use": "JSBlock",
        "stepParams": {"jsSettings": {"runJs": {"code": code}}},
    }


_BLOCK_COMPILERS = {
    "table":  _compile_table,
    "filter": _compile_filter,
    "form":   _compile_form,
    "edit":   _compile_edit,
    "detail": _compile_detail,
    "js":     _compile_js,
}


# ── Action compiler ──────────────────────────────────────────────

def _compile_actions(actions: list, block_type: str) -> list[dict]:
    """Resolve action aliases to model names within the block's context."""
    registry = ACTIONS.get(block_type, {})
    result = []
    for a in actions:
        if isinstance(a, dict):
            result.append(a)  # pass-through raw DSL
            continue
        model = registry.get(a, a)  # fallback to raw name
        result.append({"uid": None, "use": model})
    return result


# ── Field parser ─────────────────────────────────────────────────

def _parse_field(f) -> dict:
    """Parse a single field spec."""
    if isinstance(f, dict):
        return {
            "name": f.get("field", f.get("name", "")),
            "type": f.get("type", f.get("display", "text")),
            "required": f.get("required", False),
            "click": f.get("click", ""),
        }

    s = str(f).strip()
    entry: dict[str, Any] = {"type": "text", "required": False, "click": ""}

    if ">" in s:
        s, click = s.split(">", 1)
        entry["click"] = click.strip()
    if ":" in s:
        s, ftype = s.split(":", 1)
        entry["type"] = ftype.strip()
    if s.endswith("*"):
        s = s[:-1]
        entry["required"] = True

    entry["name"] = s.strip()
    return entry


def _parse_fields(fields: list) -> list[dict]:
    return [_parse_field(f) for f in fields]


# ══════════════════════════════════════════════════════════════════
#  CLI
# ══════════════════════════════════════════════════════════════════

USAGE = """
Usage:
  python compiler.py <spec.yaml>               Compile spec → DSL
  python compiler.py <spec.yaml> --validate    Validate only
  python compiler.py --actions [block_type]    Show available actions
  python compiler.py --fields                  Show available field types
  python compiler.py --blocks                  Show available block types
"""

def main():
    if len(sys.argv) < 2:
        print(USAGE)
        sys.exit(1)

    arg = sys.argv[1]

    # Help commands
    if arg == "--actions":
        ctx = sys.argv[2] if len(sys.argv) > 2 else None
        if ctx:
            acts = ACTIONS.get(ctx, {})
            if not acts:
                print(f"  Unknown block type '{ctx}'")
                print(f"  Available: {', '.join(ACTIONS.keys())}")
            else:
                print(f"\n  Actions for '{ctx}' block:\n")
                for alias, model in sorted(acts.items()):
                    print(f"    {alias:20s} → {model}Model")
        else:
            print("\n  All actions by block type:\n")
            for ctx_name, acts in ACTIONS.items():
                print(f"  [{ctx_name}]")
                for alias, model in sorted(acts.items()):
                    print(f"    {alias:20s} → {model}Model")
                print()
        return

    if arg == "--fields":
        print("\n  Display types (for table columns, detail items):\n")
        seen = set()
        for alias, model in sorted(DISPLAY.items()):
            if model not in seen:
                aliases = [a for a, m in DISPLAY.items() if m == model]
                print(f"    {', '.join(aliases):30s} → {model}Model")
                seen.add(model)
        print("\n  Edit types (for form fields, filter fields):\n")
        seen = set()
        for alias, model in sorted(EDIT.items()):
            if model not in seen:
                aliases = [a for a, m in EDIT.items() if m == model]
                print(f"    {', '.join(aliases):30s} → {model}Model")
                seen.add(model)
        return

    if arg == "--blocks":
        print("\n  Block types:\n")
        for btype, info in BLOCK_TYPES.items():
            grid = info["grid"] or "(none)"
            item = info["item"] or "(none)"
            acts = list(ACTIONS.get(btype, {}).keys())
            print(f"    {btype:10s} → {info['use']}Model")
            print(f"               grid: {grid}Model  item: {item}Model")
            if acts:
                print(f"               actions: {', '.join(acts)}")
            print()
        return

    # Compile
    validate_only = "--validate" in sys.argv
    output_path = None
    for a in sys.argv[2:]:
        if not a.startswith("-"):
            output_path = a

    compile_spec(arg, output_path, validate_only)


if __name__ == "__main__":
    main()
