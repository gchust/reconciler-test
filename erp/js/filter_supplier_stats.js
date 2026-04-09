const TARGET_BLOCK_UID = '__TABLE_UID__';
const { useState, useEffect, useCallback } = ctx.React;
const { Button, Badge, Space, Spin, Divider } = ctx.antd;

const RATING_STATS = [
  { key: 'all', label: '全部', filter: null, group: 'rating' },
  { key: 'rating_a', label: 'A-优秀', filter: { rating: { $eq: 'A' } }, group: 'rating' },
  { key: 'rating_b', label: 'B-良好', filter: { rating: { $eq: 'B' } }, group: 'rating' },
  { key: 'rating_c', label: 'C-合格', filter: { rating: { $eq: 'C' } }, group: 'rating' },
  { key: 'rating_d', label: 'D-待改善', filter: { rating: { $eq: 'D' } }, group: 'rating' },
];

const STATUS_STATS = [
  { key: 'qualified', label: '合格', filter: { status: { $eq: '合格' } }, group: 'status' },
  { key: 'trial', label: '试用', filter: { status: { $eq: '试用' } }, group: 'status' },
  { key: 'paused', label: '暂停', filter: { status: { $eq: '暂停' } }, group: 'status' },
  { key: 'eliminated', label: '淘汰', filter: { status: { $eq: '淘汰' } }, group: 'status' },
];

const ALL_STATS = [...RATING_STATS, ...STATUS_STATS];

function useStats() {
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    try {
      const queries = ALL_STATS.filter((s) => s.filter).map((s) =>
        ctx.api.request({
          url: 'nb_erp_suppliers:list',
          params: { pageSize: 1, filter: s.filter },
        }).then((res) => [s.key, res?.data?.meta?.count || 0])
      );

      const totalRes = await ctx.api.request({
        url: 'nb_erp_suppliers:list',
        params: { pageSize: 1 },
      });

      const results = await Promise.all(queries);
      const map = { all: totalRes?.data?.meta?.count || 0 };
      results.forEach(([k, v]) => { map[k] = v; });
      setCounts(map);
    } catch (e) {
      console.error('filter_supplier_stats: fetch error', e);
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
      console.error('filter_supplier_stats: filter error', e);
    }
  }, []);

  if (loading) {
    return ctx.render(<Spin size="small" />);
  }

  return ctx.render(
    <Space wrap size={[8, 8]}>
      {RATING_STATS.map((stat) => (
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
            danger={stat.key === 'eliminated'}
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
