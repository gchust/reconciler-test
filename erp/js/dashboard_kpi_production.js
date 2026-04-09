/**
 * 本月生产完工KPI卡片
 * @type JSBlockModel
 * @collection nb_erp_work_orders
 * @description 展示本月生产完工数量及良品率，与上月对比趋势
 */
const { useState, useEffect } = ctx.React;
const { Spin, Progress } = ctx.antd;

function ProductionKPI() {
  const [loading, setLoading] = useState(true);
  const [completedQty, setCompletedQty] = useState(0);
  const [defectQty, setDefectQty] = useState(0);
  const [lastCompletedQty, setLastCompletedQty] = useState(0);
  const [lastDefectQty, setLastDefectQty] = useState(0);

  useEffect(() => {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const fmt = (d) => d.toISOString().split('T')[0];

    const fetchCurrent = ctx.api.request({
      url: 'nb_erp_work_orders:list',
      params: {
        filter: {
          order_date: {
            $gte: fmt(thisMonthStart),
            $lte: fmt(thisMonthEnd),
          },
        },
        pageSize: 9999,
      },
    });

    const fetchLast = ctx.api.request({
      url: 'nb_erp_work_orders:list',
      params: {
        filter: {
          order_date: {
            $gte: fmt(lastMonthStart),
            $lte: fmt(lastMonthEnd),
          },
        },
        pageSize: 9999,
      },
    });

    Promise.all([fetchCurrent, fetchLast])
      .then(([curRes, lastRes]) => {
        const curRecords = curRes?.data?.data || [];
        const lastRecords = lastRes?.data?.data || [];

        const curCompleted = curRecords.reduce((s, r) => s + (Number(r.completed_qty) || 0), 0);
        const curDefect = curRecords.reduce((s, r) => s + (Number(r.defect_qty) || 0), 0);
        const lastCompleted = lastRecords.reduce((s, r) => s + (Number(r.completed_qty) || 0), 0);
        const lastDefect = lastRecords.reduce((s, r) => s + (Number(r.defect_qty) || 0), 0);

        setCompletedQty(curCompleted);
        setDefectQty(curDefect);
        setLastCompletedQty(lastCompleted);
        setLastDefectQty(lastDefect);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const yieldRate = completedQty > 0 ? ((completedQty - defectQty) / completedQty) * 100 : 0;
  const lastYieldRate = lastCompletedQty > 0 ? ((lastCompletedQty - lastDefectQty) / lastCompletedQty) * 100 : 0;

  const qtyTrend = lastCompletedQty > 0
    ? ((completedQty - lastCompletedQty) / lastCompletedQty) * 100
    : completedQty > 0 ? 100 : 0;
  const qtyTrendUp = qtyTrend >= 0;
  const qtyTrendIcon = qtyTrendUp ? '↑' : '↓';
  const qtyTrendColor = qtyTrendUp ? 'rgba(255,255,255,0.9)' : '#ffe58f';

  const yieldDiff = yieldRate - lastYieldRate;

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #52c41a 0%, #95de64 100%)',
        borderRadius: 12,
        padding: '24px 28px',
        minHeight: 120,
        color: '#fff',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 80 }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          <div style={{ fontSize: 14, opacity: 0.85, marginBottom: 8 }}>本月产出</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 8 }}>
            <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.2 }}>
              {completedQty.toLocaleString()}
              <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>件</span>
            </div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 600,
                background: 'rgba(255,255,255,0.2)',
                borderRadius: 8,
                padding: '2px 10px',
              }}
            >
              {yieldRate.toFixed(1)}%
              <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 2 }}>良品率</span>
            </div>
          </div>
          <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ opacity: 0.7 }}>产量</span>
              <span style={{ color: qtyTrendColor, fontWeight: 600, fontSize: 14 }}>
                {qtyTrendIcon} {Math.abs(qtyTrend).toFixed(1)}%
              </span>
            </span>
            <span style={{ opacity: 0.4 }}>|</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ opacity: 0.7 }}>良品率</span>
              <span
                style={{
                  color: yieldDiff >= 0 ? 'rgba(255,255,255,0.9)' : '#ffe58f',
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                {yieldDiff >= 0 ? '↑' : '↓'} {Math.abs(yieldDiff).toFixed(1)}pp
              </span>
            </span>
          </div>
          <div style={{ fontSize: 12, opacity: 0.5, marginTop: 6 }}>
            上月 {lastCompletedQty.toLocaleString()} 件 · 良品率 {lastYieldRate.toFixed(1)}%
          </div>
        </>
      )}
      <div
        style={{
          position: 'absolute',
          right: -20,
          top: -20,
          width: 100,
          height: 100,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.08)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 20,
          bottom: -30,
          width: 70,
          height: 70,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.06)',
        }}
      />
    </div>
  );
}

ctx.render(<ProductionKPI />);
