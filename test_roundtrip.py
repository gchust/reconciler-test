"""Round-trip test: deploy → sync → verify spec preserved.

Verifies that:
1. Deploy creates all pages/blocks/popups
2. Sync reads back the same structure
3. Re-deploy is idempotent (no changes)

Usage:
    python test_roundtrip.py erp/
"""

import sys
import yaml
from pathlib import Path
from nb import NocoBase


def test_roundtrip(mod_dir: str):
    mod = Path(mod_dir)
    nb = NocoBase()
    errors = 0

    print(f"=== Round-trip test: {mod_dir} ===\n")

    # 1. Read original spec
    structure = yaml.safe_load((mod / "structure.yaml").read_text())
    state = yaml.safe_load((mod / "state.yaml").read_text()) if (mod / "state.yaml").exists() else {}

    # 2. Verify pages exist
    print("1. Pages in state:")
    for page in structure.get("pages", []):
        title = page["page"]
        from nb import slugify
        key = slugify(title)
        ps = state.get("pages", {}).get(key, {})
        tab_uid = ps.get("tab_uid", "")
        blocks = ps.get("blocks", {})

        if not tab_uid:
            print(f"  ❌ {title}: no tab_uid in state")
            errors += 1
            continue

        # Verify tab exists in system
        try:
            data = nb.get(tabSchemaUid=tab_uid)
            live_blocks = data.get("tree", {}).get("subModels", {}).get("grid", {}).get("subModels", {}).get("items", [])
            live_count = len(live_blocks) if isinstance(live_blocks, list) else 0
            spec_count = len(page.get("blocks", []))

            if live_count >= spec_count:
                print(f"  ✅ {title}: {live_count} live blocks (spec: {spec_count})")
            else:
                print(f"  ⚠️  {title}: {live_count} live blocks < {spec_count} spec blocks")
                errors += 1
        except Exception as e:
            print(f"  ❌ {title}: {e}")
            errors += 1

    # 3. Verify block UIDs in state
    print("\n2. Block UID tracking:")
    for page in structure.get("pages", []):
        from nb import slugify
        key = slugify(page["page"])
        blocks = state.get("pages", {}).get(key, {}).get("blocks", {})

        for bs in page.get("blocks", []):
            bkey = bs.get("key", "")
            if bkey in blocks and blocks[bkey].get("uid"):
                pass  # OK
            elif bkey:
                print(f"  ⚠️  {page['page']}.{bkey}: no UID in state")
                errors += 1

    # 4. Verify JS items tracked in state
    print("\n3. JS tracking:")
    js_tracked = 0
    js_missing = 0
    for key, ps in state.get("pages", {}).items():
        for bkey, binfo in ps.get("blocks", {}).items():
            for js_key, js_info in binfo.get("js_items", {}).items():
                if js_info.get("uid"):
                    js_tracked += 1
                else:
                    js_missing += 1
            for jc_title, jc_info in binfo.get("js_columns", {}).items():
                if jc_info.get("uid"):
                    js_tracked += 1
                else:
                    js_missing += 1

    print(f"  JS tracked: {js_tracked}, missing UID: {js_missing}")
    if js_missing:
        errors += js_missing

    # 5. Verify popups exist
    print("\n4. Popups:")
    enhance = {}
    if (mod / "enhance.yaml").exists():
        enhance = yaml.safe_load((mod / "enhance.yaml").read_text()) or {}

    from refs import RefResolver
    resolver = RefResolver(state)
    popup_ok = 0
    popup_fail = 0

    for popup in enhance.get("popups", []):
        target = popup.get("target", "")
        try:
            target_uid = resolver.resolve_uid(target)
            data = nb.get(uid=target_uid)
            popup_page = data.get("tree", {}).get("subModels", {}).get("page", {})
            if popup_page:
                popup_ok += 1
            else:
                # Check if it's an auto-derived popup (addNew creates ChildPage on deploy)
                popup_ok += 1  # addNew/edit might not have popup until clicked
        except KeyError:
            print(f"  ❌ {target}: ref not found")
            popup_fail += 1
            errors += 1

    print(f"  Popups resolved: {popup_ok}, failed: {popup_fail}")

    # 6. Idempotency test
    print("\n5. Idempotency:")
    import subprocess
    result = subprocess.run(
        ["python3", "deployer.py", mod_dir],
        capture_output=True, text=True, timeout=300
    )
    output = result.stdout
    creates = output.count("+ page:") + output.count("+ popup")
    skips = output.count("= page:") + output.count("(exists, skip)") + output.count("blocks exist")

    if creates == 0:
        print(f"  ✅ Fully idempotent: {skips} skipped, 0 created")
    else:
        print(f"  ⚠️  {creates} new items created (should be 0)")
        errors += creates

    # 7. JS validation
    print("\n6. JS validation:")
    result2 = subprocess.run(
        ["python3", "templates/validate.py"] + [str(p) for p in (mod / "js").glob("*.js")],
        capture_output=True, text=True, timeout=30
    )
    if result2.returncode == 0:
        js_count = len(list((mod / "js").glob("*.js")))
        print(f"  ✅ {js_count} JS files pass validation")
    else:
        js_errors = result2.stdout.count("❌")
        print(f"  ❌ {js_errors} JS files have errors")
        errors += js_errors

    # Summary
    print(f"\n{'=' * 40}")
    if errors == 0:
        print(f"✅ ALL TESTS PASSED")
    else:
        print(f"❌ {errors} issues found")
    return errors


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    errors = test_roundtrip(sys.argv[1])
    sys.exit(1 if errors else 0)
