"""验证 JS 模板生成的代码是否符合规范。

Usage:
    python templates/validate.py erp/js/dashboard_kpi_*.js
    python templates/validate.py erp/js/filter_*.js
    python templates/validate.py erp/js/*.js          # 全部
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
#  通用检查
# ═══════════════════════════════════════════════════

@check("ctx.render 规范")
def check_render(code, path):
    renders = re.findall(r"ctx\.render\(", code)
    if len(renders) == 0:
        return "缺少 ctx.render()"
    # JSColumnModel: 允许多次 ctx.render（if/else 分支各调一次）
    fname = str(path).lower()
    is_column = "col_" in fname or "column" in fname
    if not is_column and len(renders) > 1:
        # Check if it's inside a component (return ctx.render)
        has_component = "function " in code or "const " in code and "=>" in code
        for i, line in enumerate(code.split("\n")):
            stripped = line.strip()
            if "return ctx.render(" in stripped:
                return f"行{i+1}: 组件内不要 return ctx.render()，直接 return JSX"
    return None


@check("不要直接调用函数组件")
def check_direct_call(code, path):
    # Pattern: FunctionName(); at end of file (not ctx.render(<FunctionName />))
    lines = code.strip().split("\n")
    last_line = lines[-1].strip() if lines else ""
    if re.match(r"^[A-Z]\w+\(\);?$", last_line):
        return f"最后一行 '{last_line}' 直接调用了组件，应该用 ctx.render(<{last_line.rstrip('();')} />)"
    return None


@check("不要 import（ctx 已注入）")
def check_imports(code, path):
    for i, line in enumerate(code.split("\n")):
        if line.strip().startswith("import "):
            return f"行{i+1}: 不需要 import，使用 ctx.React / ctx.antd"
    return None


# ═══════════════════════════════════════════════════
#  SQL 检查
# ═══════════════════════════════════════════════════

@check("SQL ROUND 必须转 numeric")
def check_round(code, path):
    # ROUND(x, n) where x is not ::numeric
    matches = re.findall(r"ROUND\(([^)]+),\s*\d+\)", code)
    for m in matches:
        if "::numeric" not in m and "::NUMERIC" not in m:
            return f"ROUND({m}, n) 缺少 ::numeric 转换 — PostgreSQL 要求 ROUND(x::numeric, n)"
    return None


@check("SQL 不要用 :bind 参数")
def check_bind(code, path):
    if re.search(r":\w+::", code) and "timestamp" in code:
        # :__var1::timestamp pattern
        return "SQL 不要用 :bind 参数 + ::cast，用 JS 模板字符串 ${var}"
    return None


@check("模板字符串 ${} 不要被转义")
def check_escaped_template(code, path):
    if "\\${" in code:
        return "\\${...} 被转义了，JS 模板字符串需要 ${...}（无反斜杠）"
    return None


# ═══════════════════════════════════════════════════
#  Chart 检查
# ═══════════════════════════════════════════════════

@check("Chart 数据用 ctx.data.objects")
def check_chart_data(code, path):
    if "chart" not in str(path).lower():
        return None
    if "ctx.data ||" in code and "ctx.data?.objects" not in code and "ctx.data.objects" not in code:
        return "Chart 里 ctx.data 是对象，数组在 .objects 里：const data = ctx.data?.objects || []"
    return None


# ═══════════════════════════════════════════════════
#  KPI 卡片检查
# ═══════════════════════════════════════════════════

@check("KPI 用 ctx.sql.save + runById 模式")
def check_kpi_sql(code, path):
    if "kpi" not in str(path).lower():
        return None
    if "ctx.sql.run(" in code and "ctx.sql.runById" not in code and "ctx.sql.save" not in code:
        return "KPI 应该用 ctx.sql.save({uid, sql}) + ctx.sql.runById(uid) 模式"
    return None


@check("KPI 不要用 antd Progress")
def check_kpi_progress(code, path):
    if "kpi" not in str(path).lower():
        return None
    if "Progress" in code:
        return "KPI 卡片不要用 antd Progress（会显示进度条 bug），用 createElement 样式"
    return None


# ═══════════════════════════════════════════════════
#  Filter 检查
# ═══════════════════════════════════════════════════

@check("Filter 有 TARGET_BLOCK_UID")
def check_filter_target(code, path):
    if "filter" not in str(path).lower():
        return None
    if "TARGET_BLOCK_UID" not in code and "target" not in code.lower():
        return "Filter JS 缺少 TARGET_BLOCK_UID（用于联动表格）"
    return None


# ═══════════════════════════════════════════════════
#  执行
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
