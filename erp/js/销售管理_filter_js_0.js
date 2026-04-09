const TARGET_BLOCK_UID = 'qwz3wob8vyb';
const { useState, useEffect, useCallback } = ctx.React;
const { Button, Badge, Space, Spin } = ctx.antd;

const STATS = [
  { key: 'all', label: '全部', filter: null },
  { key: 'draft', label: '草稿', filter: { status: { $eq: '草稿' } } },
  { key: 'confirmed', label: '已确认', filter: { status: { $eq: '已确认' } } },
  { key: 'producing', label: '生产中', filter: { status: { $eq: '生产中' } } },
  { key: 'ready', label: '待发货', filter: { status: { $eq: '待发货' } } },
  { key: 'partial_ship', label: '部分发货', filter: { status: { $eq: '部分发货' } } },
  { key: 'shipped', label: '已发货', filter: { status: { $eq: '已发货' } } },
  { key: 'signed', label: '已签收', filter: { status: { $eq: '已签收' } } },
  { key: 'cancelled', label: '已取消', filter: { status: { $eq: '已取消' } } },
];

function useStats() {
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    try {
      const queries = STATS.filter((s) => s.filter).map((s) =>
        ctx.api.request({
          url: 'nb_erp_sales_orders:list',
          params: { pageSize: 1, filter: s.filter },
        }).then((res) => [s.key, res?.data?.meta?.count || 0])
      );

      const totalRes = await ctx.api.request({
        url: 'nb_erp_sales_orders:list',
        params: { pageSize: 1 },
      });

      const results = await Promise.all(queries);
      const map = { all: totalRes?.data?.meta?.count || 0 };
      results.forEach(([k, v]) => { map[k] = v; });
      setCounts(map);
    } catch (e) {
      console.error('filter_so_stats: fetch error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  return { counts, loading, refresh: fetchCounts };
}

function StatsFilter() {
  const { counts, loading } = useStats();
  const [active, setActive] = useState('all');

  const handleClick = useCallback(async (stat) => {
    setActive(stat.key);
    try {
      const target = ctx.engine.getModel(TARGET_BLOCK_UID);
      if (target) {
        target.resource.addFilterGroup(ctx.model.uid, stat.filter);
        await target.resource.refresh();
      }
    } catch (e) {
      console.error('filter_so_stats: filter error', e);
    }
  }, []);

  if (loading) {
    return (<Spin size="small" />);
  }

  return (
    <Space wrap size={[8, 8]}>
      {STATS.map((stat) => (
        <Badge key={stat.key} count={counts[stat.key] ?? 0} overflowCount={9999} offset={[6, 0]}>
          <Button
            type={active === stat.key ? 'primary' : 'default'}
            size="small"
            onClick={() => handleClick(stat)}
          >
            {stat.label}
          </Button>
        </Badge>
      ))}
    </Space>
  );
}

ctx.render(<StatsFilter />);
