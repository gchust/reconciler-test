const TARGET_BLOCK_UID = '__TABLE_UID__';
const { useState, useEffect, useCallback } = ctx.React;
const { Button, Badge, Space, Spin, Divider } = ctx.antd;

const LEVEL_STATS = [
  { key: 'all', label: '全部', filter: null, group: 'level' },
  { key: 'vip', label: 'VIP', filter: { level: { $eq: 'VIP' } }, group: 'level' },
  { key: 'a', label: 'A级', filter: { level: { $eq: 'A' } }, group: 'level' },
  { key: 'b', label: 'B级', filter: { level: { $eq: 'B' } }, group: 'level' },
  { key: 'c', label: 'C级', filter: { level: { $eq: 'C' } }, group: 'level' },
];

const STATUS_STATS = [
  { key: 'active', label: '活跃', filter: { status: { $eq: '活跃' } }, group: 'status' },
  { key: 'paused', label: '暂停', filter: { status: { $eq: '暂停' } }, group: 'status' },
  { key: 'blacklist', label: '黑名单', filter: { status: { $eq: '黑名单' } }, group: 'status' },
];

const ALL_STATS = [...LEVEL_STATS, ...STATUS_STATS];

function useStats() {
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    try {
      const queries = ALL_STATS.filter((s) => s.filter).map((s) =>
        ctx.api.request({
          url: 'nb_erp_customers:list',
          params: { pageSize: 1, filter: s.filter },
        }).then((res) => [s.key, res?.data?.meta?.count || 0])
      );

      const totalRes = await ctx.api.request({
        url: 'nb_erp_customers:list',
        params: { pageSize: 1 },
      });

      const results = await Promise.all(queries);
      const map = { all: totalRes?.data?.meta?.count || 0 };
      results.forEach(([k, v]) => { map[k] = v; });
      setCounts(map);
    } catch (e) {
      console.error('filter_customer_stats: fetch error', e);
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
      console.error('filter_customer_stats: filter error', e);
    }
  }, []);

  if (loading) {
    return ctx.render(<Spin size="small" />);
  }

  return ctx.render(
    <Space wrap size={[8, 8]}>
      {LEVEL_STATS.map((stat) => (
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
      <Divider type="vertical" />
      {STATUS_STATS.map((stat) => (
        <Badge key={stat.key} count={counts[stat.key] ?? 0} overflowCount={9999} offset={[6, 0]}>
          <Button
            type={active === stat.key ? 'primary' : 'default'}
            size="small"
            danger={stat.key === 'blacklist'}
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
