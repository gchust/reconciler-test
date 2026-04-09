/**
 * KPI 卡片积木模板（CRM 原版样式，零修改）
 *
 * @type JSBlockModel
 * @template kpi-card
 *
 * === AI 修改指南 ===
 * 只改前 4 行参数，其他不要动！
 *
 * LABEL:   卡片标题
 * COLOR:   主色（文字+趋势）
 * BG:      浅背景色
 * SQL_UID: flowSql 注册的 UID（deployer 自动注册）
 * FMT:     格式化函数（可选，默认 ¥ 格式）
 *
 * SQL 要求返回两个字段:
 *   current_value  — 当前周期数值
 *   growth_rate    — 环比增长率(%)
 *
 * SQL 绑定变量:
 *   __var1 = 当前周期开始
 *   __var2 = 当前周期结束
 *   __var3 = 上一周期开始
 *   __var4 = 上一周期结束（= 当前周期开始）
 * ====================
 */
const LABEL = '本月采购额';
const COLOR = '#f59e0b';
const BG = '#fffbeb';
const SQL_UID = 'erp_kpi_purchase';
const FMT = (v) => v >= 1e6 ? `¥${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `¥${(v/1e3).toFixed(1)}K` : `¥${v.toFixed(0)}`;

// ─── 以下不要动 ───────────────────────────────────
const cardStyle = () => ({
  borderRadius: '0', padding: '24px', position: 'relative', overflow: 'hidden',
  border: 'none', boxShadow: 'none',
  margin: '-24px', height: 'calc(100% + 48px)', width: 'calc(100% + 48px)',
  display: 'flex', flexDirection: 'column', cursor: 'pointer',
});
const labelStyle = { fontSize: '0.875rem', fontWeight: '500', zIndex: 2 };
const valueStyle = { fontSize: '2rem', fontWeight: '700', marginTop: 'auto', zIndex: 2, letterSpacing: '-0.03em', color: COLOR };
const trendPillStyle = (up) => ({
  fontSize: '0.75rem', padding: '2px 8px', borderRadius: '99px', fontWeight: '600',
  background: up ? '#ecfdf5' : '#fef2f2', color: up ? '#10b981' : '#ef4444',
});
const bgChartStyle = { position: 'absolute', bottom: 0, right: 0, width: '140px', height: '90px', zIndex: 1, opacity: 0.5, pointerEvents: 'none' };

const { useState, useEffect } = ctx.React;
const h = ctx.React.createElement;

const KpiCard = () => {
  const [data, setData] = useState({ value: 0, growthRate: 0, loading: true });
  useEffect(() => { fetchData(); }, []);
  const fetchData = async () => {
    try {
      setData(prev => ({ ...prev, loading: true }));
      const startDate = ctx.libs.dayjs().startOf('month');
      const endDate = ctx.libs.dayjs().endOf('month');
      const periodLength = endDate.diff(startDate, 'day');
      const previousStart = startDate.subtract(periodLength, 'day');
      const result = await ctx.sql.runById(SQL_UID, {
        bind: {
          __var1: startDate.format('YYYY-MM-DD 00:00:00'),
          __var2: endDate.format('YYYY-MM-DD 23:59:59'),
          __var3: previousStart.format('YYYY-MM-DD 00:00:00'),
          __var4: startDate.format('YYYY-MM-DD 00:00:00'),
        }, type: 'selectRows', dataSourceKey: 'main'
      });
      const record = result?.[0] || {};
      setData({
        value: parseFloat(record.current_value || 0),
        growthRate: parseFloat(record.growth_rate || 0),
        loading: false,
      });
    } catch (e) { console.error(e); setData(prev => ({ ...prev, loading: false })); }
  };

  const up = data.growthRate >= 0;
  return h('div', { className: 'kpi-card-hover', style: cardStyle() },
    h('div', { style: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', zIndex:2 } },
      h('span', { style: labelStyle }, LABEL),
      h('span', { style: trendPillStyle(up) }, up ? `+${data.growthRate.toFixed(1)}%` : `${data.growthRate.toFixed(1)}%`)
    ),
    h('div', { style: valueStyle }, data.loading ? '...' : FMT(data.value)),
    h('svg', { style: bgChartStyle, viewBox:'0 0 100 50', preserveAspectRatio:'none' },
      h('path', { d:'M0,50 L0,30 Q25,10 50,25 T100,15 L100,50 Z', fill: BG, stroke: COLOR, strokeWidth:'1', opacity: 0.3 }))
  );
};

ctx.render(h(ctx.React.Fragment, null,
  h('style', null, ':has(> .kpi-card-hover),:has(> div > .kpi-card-hover){overflow:hidden!important}.kpi-card-hover{transition:transform .2s ease;transform:scale(0.97)}.kpi-card-hover:hover{transform:scale(1)}'),
  h(KpiCard, null)
));
