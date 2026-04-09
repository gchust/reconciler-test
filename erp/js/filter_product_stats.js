const TARGET_BLOCK_UID = '__TABLE_UID__';
const { useState, useEffect, useCallback } = ctx.React;
const { Button, Badge, Space, Spin } = ctx.antd;

const STATS = [
  { key: 'all', label: '全部', filter: null },
  { key: 'active', label: '有效', filter: { status: { $eq: '有效' } } },
  { key: 'developing', label: '开发中', filter: { status: { $eq: '开发中' } } },
  { key: 'disabled', label: '停用', filter: { status: { $eq: '停用' } } },
  { key: 'pending', label: '待审核', filter: { status: { $eq: '待审核' } } },
  { key: 'low_stock', label: '低库存', filter: { stock_qty: { $lt: { $col: 'min_stock' } } } },
];

function useStats() {
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ctx.api.request({
        url: 'nb_erp_products:list',
        params: {
          pageSize: 1,
          appends: [],
          fields: ['id', 'status', 'stock_qty', 'min_stock'],
          page: 1,
        },
      });
      const total = res?.data?.meta?.count || 0;

      const statusRes = await Promise.all([
        ctx.api.request({
          url: 'nb_erp_products:list',
          params: { pageSize: 1, filter: { status: { $eq: '有效' } } },
        }),
        ctx.api.request({
          url: 'nb_erp_products:list',
          params: { pageSize: 1, filter: { status: { $eq: '开发中' } } },
        }),
        ctx.api.request({
          url: 'nb_erp_products:list',
          params: { pageSize: 1, filter: { status: { $eq: '停用' } } },
        }),
        ctx.api.request({
          url: 'nb_erp_products:list',
          params: { pageSize: 1, filter: { status: { $eq: '待审核' } } },
        }),
        ctx.api.request({
          url: 'nb_erp_products:list',
          params: { pageSize: 1, filter: { stock_qty: { $lt: { $col: 'min_stock' } } } },
        }),
      ]);

      setCounts({
        all: total,
        active: statusRes[0]?.data?.meta?.count || 0,
        developing: statusRes[1]?.data?.meta?.count || 0,
        disabled: statusRes[2]?.data?.meta?.count || 0,
        pending: statusRes[3]?.data?.meta?.count || 0,
        low_stock: statusRes[4]?.data?.meta?.count || 0,
      });
    } catch (e) {
      console.error('filter_product_stats: fetch error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  return { counts, loading, refresh: fetchCounts };
}

function StatsFilter() {
  const { counts, loading, refresh } = useStats();
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
      console.error('filter_product_stats: filter error', e);
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
            danger={stat.key === 'low_stock'}
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
