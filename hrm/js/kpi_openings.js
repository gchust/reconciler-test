/**
 * Open Positions KPI Card
 *
 * @type JSBlockModel
 * @template kpi-card
 */

// ─── CONFIG: AI modifies here ────────────────────────────────
const LABEL = 'Open Positions';
const COLOR = '#8b5cf6';
const BG = '#f5f3ff';
const SQL_UID = 'hrm_kpi_openings';
const FMT = (v) => v.toFixed(0);

const buildSql = (startDate, endDate, prevStart, prevEnd) => `
SELECT
  COUNT(*) as current_value,
  0 as growth_rate
FROM hrm_recruitment
WHERE status IN ('Open', 'Screening', 'Interviewing', 'Offer')
`;
// ─── CONFIG END ────────────────────────────────────

// ─── Do not modify below ─────────────────────────────────────
const { useState, useEffect } = ctx.React;
const h = ctx.React.createElement;

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

const KpiCard = () => {
  const [data, setData] = useState({ value: 0, growthRate: 0, loading: true });

  useEffect(() => {
    (async () => {
      try {
        const now = ctx.libs.dayjs();
        const startDate = now.startOf('month').format('YYYY-MM-DD 00:00:00');
        const endDate = now.endOf('month').format('YYYY-MM-DD 23:59:59');
        const prevStart = now.subtract(1, 'month').startOf('month').format('YYYY-MM-DD 00:00:00');
        const prevEnd = now.startOf('month').format('YYYY-MM-DD 00:00:00');

        const sql = buildSql(startDate, endDate, prevStart, prevEnd);

        try {
          await ctx.sql.save({ uid: SQL_UID, sql: sql.trim(), dataSourceKey: 'main' });
        } catch (e) { /* ignore if already saved */ }

        const result = await ctx.sql.runById(SQL_UID, {
          type: 'selectRows', dataSourceKey: 'main',
        });

        const record = result?.[0] || {};
        setData({
          value: parseFloat(record.current_value || 0),
          growthRate: parseFloat(record.growth_rate || 0),
          loading: false,
        });
      } catch (e) {
        console.error('KPI error:', e);
        setData(prev => ({ ...prev, loading: false }));
      }
    })();
  }, []);

  const up = data.growthRate >= 0;
  return h('div', { className: 'kpi-card-hover', style: cardStyle() },
    h('div', { style: { display:'flex', justifyContent:'space-between', alignItems:'flex-start', zIndex:2 } },
      h('span', { style: labelStyle }, LABEL),
      data.growthRate !== 0 && h('span', { style: trendPillStyle(up) }, up ? `+${data.growthRate.toFixed(1)}%` : `${data.growthRate.toFixed(1)}%`)
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
