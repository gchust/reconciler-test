const TARGET_BLOCK_UID = '__TABLE_UID__';
const { useState, useEffect, useCallback } = ctx.React;
const { Button, Badge, Space, Spin } = ctx.antd;

const STATS = [
  { key: 'all', label: '全部', filter: null },
  { key: 'scheduled', label: '待排产', filter: { status: { $eq: '待排产' } } },
  { key: 'producing', label: '生产中', filter: { status: { $eq: '生产中' } } },
  { key: 'paused', label: '暂停', filter: { status: { $eq: '暂停' } } },
  { key: 'completed', label: '已完工', filter: { status: { $eq: '已完工' } } },
  { key: 'closed', label: '已关闭', filter: { status: { $eq: '已关闭' } } },
];

function useStats() {
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    try {
      const queries = STATS.filter((s) => s.filter).map((s) =>
        ctx.api.request({
          url: 'nb_erp_work_orders:list',
          params: { pageSize: 1, filter: s.filter },
        }).then((res) => [s.key, res?.data?.meta?.count || 0])
      );

      const totalRes = await ctx.api.request({
        url: 'nb_erp_work_orders:list',
        params: { pageSize: 1 },
      });

      const results = await Promise.all(queries);
      const map = { all: totalRes?.data?.meta?.count || 0 };
      results.forEach(([k, v]) => { map[k] = v; });
      setCounts(map);
    } catch (e) {
      console.error('filter_wo_stats: fetch error', e);
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
      console.error('filter_wo_stats: filter error', e);
    }
  }, []);

  if (loading) {
    return ctx.render(<Spin size="small" />);
  }

  return ctx.render(
    <Space wrap size={[8, 8]}>
      {STATS.map((stat) => (
        <Badge key={stat.key} count={counts[stat.key] ?? 0} overflowCount={9999} offset={[6, 0]}>
          <Button
            type={active === stat.key ? 'primary' : 'default'}
            size="small"
            danger={stat.key === 'paused'}
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
