/**
 * 本月质检合格率KPI卡片
 * @type JSBlockModel
 * @collection nb_erp_quality
 * @description 展示本月质检合格率及检验批次数，与上月对比趋势
 */
const { useState, useEffect } = ctx.React;
const { Spin, Progress } = ctx.antd;

function QualityKPI() {
  const [loading, setLoading] = useState(true);
  const [passQty, setPassQty] = useState(0);
  const [sampleQty, setSampleQty] = useState(0);
  const [inspectionCount, setInspectionCount] = useState(0);
  const [lastPassQty, setLastPassQty] = useState(0);
  const [lastSampleQty, setLastSampleQty] = useState(0);

  useEffect(() => {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const fmt = (d) => d.toISOString().split('T')[0];

    const fetchCurrent = ctx.api.request({
      url: 'nb_erp_quality:list',
      params: {
        filter: {
          inspect_date: {
            $gte: fmt(thisMonthStart),
            $lte: fmt(thisMonthEnd),
          },
        },
        pageSize: 9999,
      },
    });

    const fetchLast = ctx.api.request({
      url: 'nb_erp_quality:list',
      params: {
        filter: {
          inspect_date: {
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

        const curPass = curRecords.reduce((s, r) => s + (Number(r.pass_qty) || 0), 0);
        const curSample = curRecords.reduce((s, r) => s + (Number(r.sample_qty) || 0), 0);
        const lPass = lastRecords.reduce((s, r) => s + (Number(r.pass_qty) || 0), 0);
        const lSample = lastRecords.reduce((s, r) => s + (Number(r.sample_qty) || 0), 0);

        setPassQty(curPass);
        setSampleQty(curSample);
        setInspectionCount(curRecords.length);
        setLastPassQty(lPass);
        setLastSampleQty(lSample);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const passRate = sampleQty > 0 ? (passQty / sampleQty) * 100 : 0;
  const lastPassRate = lastSampleQty > 0 ? (lastPassQty / lastSampleQty) * 100 : 0;
  const rateDiff = passRate - lastPassRate;
  const rateUp = rateDiff >= 0;
  const rateIcon = rateUp ? '↑' : '↓';
  const rateColor = rateUp ? 'rgba(255,255,255,0.9)' : '#ffe58f';

  // Progress bar color based on pass rate level
  const progressColor = passRate >= 98 ? '#b7eb8f' : passRate >= 95 ? '#ffffb8' : '#ffa39e';

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)',
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
          <div style={{ fontSize: 14, opacity: 0.85, marginBottom: 8 }}>本月合格率</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.2 }}>
              {passRate.toFixed(1)}
              <span style={{ fontSize: 18, fontWeight: 500 }}>%</span>
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                background: 'rgba(255,255,255,0.15)',
                borderRadius: 4,
                height: 8,
                width: '100%',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  background: progressColor,
                  height: '100%',
                  width: `${Math.min(passRate, 100)}%`,
                  borderRadius: 4,
                  transition: 'width 0.6s ease',
                }}
              />
            </div>
          </div>
          <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ opacity: 0.7 }}>环比</span>
              <span style={{ color: rateColor, fontWeight: 600, fontSize: 14 }}>
                {rateIcon} {Math.abs(rateDiff).toFixed(1)}pp
              </span>
            </span>
            <span style={{ opacity: 0.4 }}>|</span>
            <span style={{ opacity: 0.7 }}>
              检验 {inspectionCount.toLocaleString()} 批 · 抽样 {sampleQty.toLocaleString()} 件
            </span>
          </div>
          <div style={{ fontSize: 12, opacity: 0.5, marginTop: 6 }}>
            上月合格率 {lastPassRate.toFixed(1)}% · 合格 {passQty.toLocaleString()} / {sampleQty.toLocaleString()}
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

ctx.render(<QualityKPI />);
