# DSL 使用测试流程

用独立的 Claude Code 会话充当**使用者**角色，测试 DSL 的完整搭建流程。
Agent 只看 GUIDE.md，不看源码。遇到问题提测试报告，由开发者修 bug。

## 前置准备

```bash
# 1. 清理测试数据（在当前会话执行）
cd /home/albert/prj/vscodes/nocobase-reconciler/src
NB_USER=admin@nocobase.com NB_PASSWORD=admin123 npx tsx -e "
const { NocoBaseClient } = require('./client');
(async () => {
  const nb = await NocoBaseClient.create();
  // 删除测试集合
  const resp = await nb.http.get(nb.baseUrl + '/api/collections:list', { params: { paginate: false } });
  for (const c of (resp.data.data || []).filter(c => c.name.startsWith('nb_erp_'))) {
    await nb.http.post(nb.baseUrl + '/api/collections:destroy', {}, { params: { filterByTk: c.name } });
    console.log('Deleted:', c.name);
  }
  // 删除测试路由
  const routes = await nb.http.get(nb.baseUrl + '/api/desktopRoutes:list', { params: { paginate: 'false', tree: 'true' } });
  for (const r of (routes.data.data || []).filter(r => r.title === 'ERPTest')) {
    await nb.http.post(nb.baseUrl + '/api/desktopRoutes:destroy', {}, { params: { filterByTk: r.id } });
    console.log('Deleted route:', r.title);
  }
  console.log('Clean');
})();
"

# 2. 清理本地文件
rm -rf /tmp/erp-test/
```

## 启动测试 Agent

必须用 TUI 模式，在目标项目目录启动（Claude Code 以 git root 为工作目录）。

```bash
# 创建 tmux 会话，-c 指定工作目录
tmux new-session -d -s agent1 -x 200 -y 50 -c /home/albert/prj/vscodes/nocobase-reconciler

# 启动 Claude（必须 unset 环境变量，否则报"嵌套会话"错误）
tmux send-keys -t agent1 "env -u CLAUDECODE -u CLAUDE_CODE_RUNNING claude --dangerously-skip-permissions" Enter

# 等待初始化（20-25秒）
sleep 25

# 确认就绪（应显示 nocobase-reconciler git:(main)）
tmux capture-pane -t agent1 -p | tail -5
```

## 发送测试 Prompt

将以下内容保存为 `/tmp/test-prompt.txt`，然后粘贴到 agent：

```bash
tmux load-buffer /tmp/test-prompt.txt
tmux paste-buffer -t agent1
tmux send-keys -t agent1 "" Enter
```

### Prompt 模板

```
你是一个 NocoBase 系统搭建人员。请使用项目里的 DSL 工具从零搭建一个 ERP 系统。

请先读 GUIDE.md 了解用法，然后按以下步骤操作：

1. scaffold 生成项目骨架
2. 根据需求调整数据表字段和页面布局
3. deploy 部署到 NocoBase
4. 检查结果，有错误就修复重试

## ERP 需求

数据表：
- nb_erp_products: name, sku, price(number), category(m2o->nb_erp_categories), stock_qty(integer), status(select)
- nb_erp_categories: name, description
- nb_erp_suppliers: name, contact, phone, email, address
- nb_erp_purchase_orders: code, supplier(m2o->nb_erp_suppliers), order_date(dateOnly), total_amount(number), status(select)
- nb_erp_po_items: product(m2o->nb_erp_products), purchase_order(m2o->nb_erp_purchase_orders), quantity(integer), unit_price(number)
- nb_erp_warehouses: name, location, capacity(integer)
- nb_erp_inventory: product(m2o->nb_erp_products), warehouse(m2o->nb_erp_warehouses), quantity(integer), last_updated(dateOnly)

CLI 命令：
- scaffold: cd src && npx tsx cli/cli.ts scaffold /tmp/erp-test/ --collections nb_erp_products,nb_erp_categories,nb_erp_suppliers,nb_erp_purchase_orders,nb_erp_po_items,nb_erp_warehouses,nb_erp_inventory
- deploy: cd src && NB_USER=admin@nocobase.com NB_PASSWORD=admin123 npx tsx cli/cli.ts deploy-project /tmp/erp-test/ --group ERPTest --force

不要研究源码。只看 GUIDE.md，用工具搭建。遇到错误记录下来，最后给我一份测试报告。
```

## 监控进度

```bash
# 查看当前输出
tmux capture-pane -t agent1 -p -J | tail -30

# 持续监控（每10秒刷新）
watch -n 10 'tmux capture-pane -t agent1 -p -J | tail -30'
```

## 收集结果

Agent 完成后，检查：

```bash
# 生成的 DSL 文件
ls /tmp/erp-test/

# 部署日志（agent 输出）
tmux capture-pane -t agent1 -p -J -S -1000 > /tmp/erp-test-log.txt

# NocoBase 中的实际效果
# 浏览器打开 http://localhost:14000 查看
```

## 结束

```bash
tmux send-keys -t agent1 "/exit" Enter
tmux kill-session -t agent1
```

## 测试检查项

部署后验证：

| 检查项 | 预期 |
|--------|------|
| 数据表创建 | 7 个集合全部存在 |
| 关系字段 | m2o 关联正确，titleField 设置 |
| 页面分组 | ERPTest group 下所有页面 |
| 页面排序 | 按 routes.yaml 顺序 |
| 筛选表单 | 有 filterForm + JS stats |
| 弹窗模板 | 字段点击有详情弹窗 |
| m2o 点击 | 关联字段点击打开正确弹窗 |
| 新增/编辑 | 弹窗有完整表单字段 |
| 无报错 | 无 compose 400、无缺失字段 |
