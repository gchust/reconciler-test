/**
 * 订单统计 KPI 卡片
 */
const { useState, useEffect } = ctx.React;
const { Card, Statistic, Row, Col, Spin } = ctx.antd;

function useOrderStats() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [total, pending, completed] = await Promise.all([
          ctx.api.request({ url: 'demo_orders:list', params: { pageSize: 1 } }),
          ctx.api.request({ url: 'demo_orders:list', params: { pageSize: 1, filter: JSON.stringify({ status: '待确认' }) } }),
          ctx.api.request({ url: 'demo_orders:list', params: { pageSize: 1, filter: JSON.stringify({ status: '已完成' }) } }),
        ]);
        setStats({
          total: total?.data?.meta?.count || 0,
          pending: pending?.data?.meta?.count || 0,
          completed: completed?.data?.meta?.count || 0,
        });
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);

  return { stats, loading };
}

const KPI = () => {
  const { stats, loading } = useOrderStats();
  if (loading) return <Spin />;
  return (
    <Row gutter={16}>
      <Col span={8}>
        <Card size="small">
          <Statistic title="全部订单" value={stats?.total || 0} />
        </Card>
      </Col>
      <Col span={8}>
        <Card size="small">
          <Statistic title="待确认" value={stats?.pending || 0} valueStyle={{ color: '#faad14' }} />
        </Card>
      </Col>
      <Col span={8}>
        <Card size="small">
          <Statistic title="已完成" value={stats?.completed || 0} valueStyle={{ color: '#52c41a' }} />
        </Card>
      </Col>
    </Row>
  );
};

ctx.render(<KPI />);
