/**
 * 本月销售额KPI卡片
 * @type JSBlockModel
 * @collection nb_erp_sales_orders
 * @description 展示本月销售总额，与上月对比趋势
 */
const { useState, useEffect } = ctx.React;
const { Spin } = ctx.antd;

function SalesKPI() {
  const [loading, setLoading] = useState(true);
  const [currentAmount, setCurrentAmount] = useState(0);
  const [lastAmount, setLastAmount] = useState(0);

  useEffect(() => {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const fmt = (d) => d.toISOString().split('T')[0];

    const fetchCurrent = ctx.api.request({
      url: 'nb_erp_sales_orders:list',
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
      url: 'nb_erp_sales_orders:list',
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
        const curSum = curRecords.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
        const lastSum = lastRecords.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
        setCurrentAmount(curSum);
        setLastAmount(lastSum);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const trend = lastAmount > 0 ? ((currentAmount - lastAmount) / lastAmount) * 100 : currentAmount > 0 ? 100 : 0;
  const trendUp = trend >= 0;
  const trendIcon = trendUp ? '↑' : '↓';
  const trendColor = trendUp ? 'rgba(255,255,255,0.9)' : '#ffe58f';

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)',
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
          <div style={{ fontSize: 14, opacity: 0.85, marginBottom: 8 }}>本月销售额</div>
          <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.2, marginBottom: 8 }}>
            ¥ {currentAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ opacity: 0.7 }}>环比上月</span>
            <span
              style={{
                color: trendColor,
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {trendIcon} {Math.abs(trend).toFixed(1)}%
            </span>
          </div>
          <div style={{ fontSize: 12, opacity: 0.5, marginTop: 6 }}>
            上月 ¥{lastAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

ctx.render(<SalesKPI />);
