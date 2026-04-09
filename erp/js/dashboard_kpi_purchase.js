/**
 * KPI 卡片积木模板（CRM 同款样式）
 *
 * @type JSBlockModel
 * @template kpi-card
 *
 * === AI 修改指南 ===
 * 1. 修改 CONFIG（标题、颜色、前缀）
 * 2. 修改 fetchData 里的 API 调用或 SQL
 * 3. 修改 parseData 提取数值
 * 4. 不要动样式系统和 KpiCard 组件
 * ====================
 */

// ─── CONFIG: AI 修改这里 ───────────────────────────
const CONFIG = {
  title: '本月采购额',
  color: '#f59e0b',           // 主色（数值、趋势）
  bgColor: '#fffbeb',         // 浅背景色
  prefix: '¥',                // 数值前缀
  suffix: '',                  // 数值后缀
  collection: 'nb_erp_purchase_orders',
  dateField: 'order_date',    // 日期字段（用于按月筛选）
  // 从 API 结果计算数值
  calcValue: (records) => records.reduce((sum, r) => sum + parseFloat(r.total_amount || 0), 0),
  // 排除的状态
  excludeStatus: ['已取消', '草稿'],
};
// ─── CONFIG END ────────────────────────────────────

// ─── 样式系统（CRM 同款，不要动） ─────────────────
const cardStyle = {
  borderRadius: 0, padding: 24, position: 'relative', overflow: 'hidden',
  border: 'none', boxShadow: 'none',
  margin: -24, height: 'calc(100% + 48px)', width: 'calc(100% + 48px)',
  display: 'flex', flexDirection: 'column', background: CONFIG.bgColor,
};
const labelStyle = { fontSize: '0.875rem', fontWeight: 500, zIndex: 2, color: '#666' };
const valueStyle = { fontSize: '2rem', fontWeight: 700, marginTop: 'auto', zIndex: 2, letterSpacing: '-0.03em', color: CONFIG.color };
const trendStyle = (up) => ({
  fontSize: '0.75rem', padding: '2px 8px', borderRadius: 99, fontWeight: 600,
  background: up ? '#ecfdf5' : '#fef2f2', color: up ? '#10b981' : '#ef4444',
  display: 'inline-block',
});
const bgCircle = (size, right, top, opacity) => ({
  position: 'absolute', right, top, width: size, height: size,
  borderRadius: '50%', background: CONFIG.color, opacity, zIndex: 1,
});

const fmt = (v) => {
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${CONFIG.prefix}${(v/1e8).toFixed(1)}亿${CONFIG.suffix}`;
  if (abs >= 1e4) return `${CONFIG.prefix}${(v/1e4).toFixed(1)}万${CONFIG.suffix}`;
  if (abs >= 1e3) return `${CONFIG.prefix}${v.toLocaleString('zh-CN', {maximumFractionDigits: 0})}${CONFIG.suffix}`;
  return `${CONFIG.prefix}${v.toFixed(v % 1 ? 1 : 0)}${CONFIG.suffix}`;
};

// ─── 组件（不要动） ───────────────────────────────
const { useState, useEffect } = ctx.React;
const { Spin } = ctx.antd;

const KpiCard = () => {
  const [state, setState] = useState({ value: 0, previous: 0, loading: true });

  useEffect(() => {
    (async () => {
      try {
        const now = ctx.libs.dayjs();
        const thisStart = now.startOf('month').format('YYYY-MM-DD');
        const thisEnd = now.endOf('month').format('YYYY-MM-DD');
        const lastStart = now.subtract(1, 'month').startOf('month').format('YYYY-MM-DD');
        const lastEnd = now.subtract(1, 'month').endOf('month').format('YYYY-MM-DD');

        const baseFilter = CONFIG.excludeStatus.length
          ? { status: { $notIn: CONFIG.excludeStatus } } : {};

        const [curr, prev] = await Promise.all([
          ctx.api.request({
            url: `${CONFIG.collection}:list`,
            params: { pageSize: 9999, filter: { ...baseFilter,
              [CONFIG.dateField]: { $gte: thisStart, $lte: thisEnd } } },
          }),
          ctx.api.request({
            url: `${CONFIG.collection}:list`,
            params: { pageSize: 9999, filter: { ...baseFilter,
              [CONFIG.dateField]: { $gte: lastStart, $lte: lastEnd } } },
          }),
        ]);

        setState({
          value: CONFIG.calcValue(curr?.data?.data || []),
          previous: CONFIG.calcValue(prev?.data?.data || []),
          loading: false,
        });
      } catch (e) {
        console.error('KPI error:', e);
        setState(s => ({ ...s, loading: false }));
      }
    })();
  }, []);

  const trend = state.previous > 0
    ? ((state.value - state.previous) / state.previous * 100).toFixed(1) : null;
  const up = parseFloat(trend) >= 0;

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', zIndex: 2 }}>
        <span style={labelStyle}>{CONFIG.title}</span>
        {trend !== null && (
          <span style={trendStyle(up)}>{up ? '+' : ''}{trend}%</span>
        )}
      </div>
      <div style={valueStyle}>
        {state.loading ? '...' : fmt(state.value)}
      </div>
      <div style={bgCircle(100, -20, -20, 0.06)} />
      <div style={bgCircle(60, 40, 'auto', 0.04)} />
    </div>
  );
};

ctx.render(<KpiCard />);
