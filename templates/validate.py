"""Validate JS code generated from templates against coding standards.

Usage:
    python templates/validate.py erp/js/dashboard_kpi_*.js
    python templates/validate.py erp/js/filter_*.js
    python templates/validate.py erp/js/*.js          # all files
"""

import re
import sys
from pathlib import Path


CHECKS = []

def check(name):
    def decorator(fn):
        CHECKS.append((name, fn))
        return fn
    return decorator


# ═══════════════════════════════════════════════════
#  General checks
# ═══════════════════════════════════════════════════

@check("ctx.render convention")
def check_render(code, path):
    renders = re.findall(r"ctx\.render\(", code)
    if len(renders) == 0:
        return "Missing ctx.render()"
    # JSColumnModel: multiple ctx.render allowed (one per if/else branch)
    fname = str(path).lower()
    is_column = "col_" in fname or "column" in fname
    if not is_column and len(renders) > 1:
        # Check if it's inside a component (return ctx.render)
        has_component = "function " in code or "const " in code and "=>" in code
        for i, line in enumerate(code.split("\n")):
            stripped = line.strip()
            if "return ctx.render(" in stripped:
                return f"Line {i+1}: Do not use return ctx.render() inside a component — return JSX directly"
    return None


@check("Do not call function components directly")
def check_direct_call(code, path):
    # Pattern: FunctionName(); at end of file (not ctx.render(<FunctionName />))
    lines = code.strip().split("\n")
    last_line = lines[-1].strip() if lines else ""
    if re.match(r"^[A-Z]\w+\(\);?$", last_line):
        return f"Last line '{last_line}' calls the component directly — use ctx.render(<{last_line.rstrip('();')} />) instead"
    return None


@check("Do not import (ctx is already injected)")
def check_imports(code, path):
    for i, line in enumerate(code.split("\n")):
        if line.strip().startswith("import "):
            return f"Line {i+1}: No imports needed — use ctx.React / ctx.antd"
    return None


# ═══════════════════════════════════════════════════
#  SQL checks
# ═══════════════════════════════════════════════════

@check("SQL ROUND must cast to numeric")
def check_round(code, path):
    # ROUND(x, n) where x is not ::numeric
    matches = re.findall(r"ROUND\(([^)]+),\s*\d+\)", code)
    for m in matches:
        if "::numeric" not in m and "::NUMERIC" not in m:
            return f"ROUND({m}, n) missing ::numeric cast — PostgreSQL requires ROUND(x::numeric, n)"
    return None


@check("SQL must not use :bind parameters")
def check_bind(code, path):
    if re.search(r":\w+::", code) and "timestamp" in code:
        # :__var1::timestamp pattern
        return "SQL must not use :bind parameters with ::cast — use JS template literals ${var} instead"
    return None


@check("Template literal ${} must not be escaped")
def check_escaped_template(code, path):
    if "\\${" in code:
        return "\\${...} is escaped — JS template literals require ${...} (no backslash)"
    return None


# ═══════════════════════════════════════════════════
#  Chart checks
# ═══════════════════════════════════════════════════

@check("Chart data must use ctx.data.objects")
def check_chart_data(code, path):
    if "chart" not in str(path).lower():
        return None
    if "ctx.data ||" in code and "ctx.data?.objects" not in code and "ctx.data.objects" not in code:
        return "In charts, ctx.data is an object — the array is in .objects: const data = ctx.data?.objects || []"
    return None


# ═══════════════════════════════════════════════════
#  KPI card checks
# ═══════════════════════════════════════════════════

@check("KPI must use ctx.sql.save + runById pattern")
def check_kpi_sql(code, path):
    if "kpi" not in str(path).lower():
        return None
    if "ctx.sql.run(" in code and "ctx.sql.runById" not in code and "ctx.sql.save" not in code:
        return "KPI should use the ctx.sql.save({uid, sql}) + ctx.sql.runById(uid) pattern"
    return None


@check("KPI must not use antd Progress")
def check_kpi_progress(code, path):
    if "kpi" not in str(path).lower():
        return None
    if "Progress" in code:
        return "KPI cards must not use antd Progress (causes a progress bar rendering bug) — use createElement styling instead"
    return None


# ═══════════════════════════════════════════════════
#  Filter checks
# ═══════════════════════════════════════════════════

@check("Filter must have TARGET_BLOCK_UID")
def check_filter_target(code, path):
    if "filter" not in str(path).lower():
        return None
    if "TARGET_BLOCK_UID" not in code and "target" not in code.lower():
        return "Filter JS is missing TARGET_BLOCK_UID (needed for linked table filtering)"
    return None


# ═══════════════════════════════════════════════════
#  Execution
# ═══════════════════════════════════════════════════

def validate_file(path: Path) -> list[str]:
    code = path.read_text()
    errors = []
    for name, fn in CHECKS:
        err = fn(code, path)
        if err:
            errors.append(f"  [{name}] {err}")
    return errors


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    import glob
    files = []
    for pattern in sys.argv[1:]:
        files.extend(glob.glob(pattern))

    total_errors = 0
    for f in sorted(files):
        path = Path(f)
        if not path.suffix == ".js":
            continue
        errors = validate_file(path)
        if errors:
            print(f"\n❌ {path.name}:")
            for e in errors:
                print(e)
            total_errors += len(errors)
        else:
            print(f"✅ {path.name}")

    print(f"\n{'─' * 40}")
    print(f"Files: {len(files)}, Errors: {total_errors}")
    if total_errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
