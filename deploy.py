"""Module deployer — compile + apply a complete module (group > pages > blocks).

Reads a module spec (.spec.yaml with 'module' key), then:
1. Creates collections + fields
2. Creates menu group
3. For each page: compile → apply (one .dsl.yaml per page)

Usage:
    python deploy.py inventory.spec.yaml          # deploy full module
    python deploy.py inventory.spec.yaml --dry    # dry run (validate + show plan)
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import yaml

from dsl import NB, _dump_yaml, gen_uid, slugify
from compiler import compile_spec, validate_spec, _compile, BLOCK_TYPES


def deploy_module(spec_path: str, dry_run: bool = False):
    spec = yaml.safe_load(Path(spec_path).read_text())

    module_name = spec.get("module")
    if not module_name:
        print("  Not a module spec (no 'module' key). Use compiler.py for single pages.")
        sys.exit(1)

    icon = spec.get("icon", "appstoreoutlined")
    pages_spec = spec.get("pages", [])
    colls_spec = spec.get("collections", {})

    print(f"\n  Module: {module_name}")
    print(f"  Collections: {len(colls_spec)}")
    print(f"  Pages: {len(pages_spec)}")

    # ── Validate all pages ──
    print(f"\n  Validating...")
    has_errors = False
    for i, ps in enumerate(pages_spec):
        # Build a single-page spec for validation
        single = {
            "page": ps.get("page", f"page-{i}"),
            "coll": ps.get("coll", spec.get("coll", "")),
            "blocks": ps.get("blocks", []),
        }
        errors = validate_spec(single)
        page_errors = [e for e in errors if e.level == "error"]
        if page_errors:
            has_errors = True
            print(f"\n  Page '{single['page']}':")
            for e in errors:
                print(e)

    if has_errors:
        print(f"\n  Fix errors above before deploying.")
        return

    print(f"  All pages valid.")

    if dry_run:
        print(f"\n  Plan:")
        for name, coll_def in colls_spec.items():
            print(f"    + collection: {name} ({coll_def.get('title', name)})")
        print(f"    + group: {module_name}")
        for ps in pages_spec:
            block_count = len(ps.get("blocks", []))
            print(f"    + page: {ps.get('page', '?')} ({block_count} blocks)")
        print(f"\n  Use without --dry to deploy.")
        return

    # ── Connect to NocoBase ──
    nb = NB()
    print(f"\n  Connected to {nb.base}")

    # ── 1. Create collections ──
    if colls_spec:
        print(f"\n  Creating collections...")
        for coll_name, coll_def in colls_spec.items():
            title = coll_def.get("title", coll_name)
            if nb.collection_exists(coll_name):
                print(f"    = {coll_name} (exists)")
            else:
                nb.create_collection(coll_name, title)
                print(f"    + {coll_name}")

            # Create fields
            meta = nb.field_meta(coll_name)
            for fdef in coll_def.get("fields", []):
                fname = fdef["name"]
                if fname in ("id", "createdAt", "updatedAt", "createdBy", "updatedBy"):
                    continue
                if fname in meta:
                    continue
                iface = fdef.get("interface", "input")
                ftitle = fdef.get("title", fname)
                opts = {}
                if "options" in fdef:
                    opts["options"] = fdef["options"]
                try:
                    nb.create_field(coll_name, fname, iface, ftitle, **opts)
                    print(f"      + {coll_name}.{fname}")
                except Exception as e:
                    print(f"      ! {coll_name}.{fname}: {e}")

    # ── 2. Create menu group ──
    print(f"\n  Creating group...")
    # Check if group already exists
    group_id = _find_group(nb, module_name)
    if group_id:
        print(f"    = {module_name} (exists, id={group_id})")
    else:
        group_id = nb.create_group_route(module_name, icon=icon)
        print(f"    + {module_name} (id={group_id})")

    # ── 3. Create pages ──
    print(f"\n  Creating pages...")
    out_dir = Path(spec_path).parent

    for ps in pages_spec:
        page_title = ps.get("page", "Untitled")
        page_slug = slugify(page_title)
        dsl_path = out_dir / f"{page_slug}.dsl.yaml"

        # Compile page spec → DSL
        page_spec = {
            "page": page_title,
            "coll": ps.get("coll", spec.get("coll", "")),
            "blocks": ps.get("blocks", []),
            "icon": ps.get("icon", "fileoutlined"),
        }
        dsl = _compile(page_spec)

        # Check if page already deployed (DSL file with tab UID)
        if dsl_path.exists():
            existing = yaml.safe_load(dsl_path.read_text())
            if existing and existing.get("tab"):
                dsl["tab"] = existing["tab"]
                dsl["route"] = existing.get("route")
                dsl["page_uid"] = existing.get("page_uid")

        # Create route if needed
        if not dsl.get("tab"):
            route_id, page_uid, tab_uid = nb.create_page_route(
                page_title, group_id, icon=ps.get("icon", "fileoutlined"))
            dsl["tab"] = tab_uid
            dsl["route"] = route_id
            dsl["page_uid"] = page_uid
            print(f"    + {page_title} (tab={tab_uid})")
        else:
            print(f"    = {page_title} (tab={dsl['tab']})")

        # Write DSL
        dsl_path.write_text(_dump_yaml(dsl))

        # Apply via dsl.py
        from dsl import apply_dsl
        apply_dsl(str(dsl_path), nb)

    print(f"\n  Module '{module_name}' deployed.")


def _find_group(nb: NB, title: str) -> int | None:
    """Find existing group route by title."""
    for r in nb.routes():
        if r.get("type") == "group" and r.get("title") == title:
            return r["id"]
    return None


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    spec_path = sys.argv[1]
    dry_run = "--dry" in sys.argv
    deploy_module(spec_path, dry_run)
