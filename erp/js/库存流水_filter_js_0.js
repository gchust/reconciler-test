const TARGET_BLOCK_UID = 'pr52g7108ir';
const { useState, useEffect, useCallback } = ctx.React;
const { Button, Badge, Space, Spin, Divider } = ctx.antd;

const INBOUND_TYPES = ['采购入库', '生产入库', '退货入库', '盘盈'];
const OUTBOUND_TYPES = ['销售出库', '生产领料', '盘亏'];
const TRANSFER_TYPES = ['调拨'];

const STATS = [
  { key: 'all', label: '全部', filter: null },
  {
    key: 'inbound',
    label: '入库',
    filter: { txn_type: { $in: INBOUND_TYPES } },
  },
  {
    key: 'outbound',
    label: '出库',
    filter: { txn_type: { $in: OUTBOUND_TYPES } },
  },
  {
    key: 'transfer',
    label: '调拨',
    filter: { txn_type: { $in: TRANSFER_TYPES } },
  },
];

const DETAIL_STATS = [
  { key: 'purchase_in', label: '采购入库', filter: { txn_type: { $eq: '采购入库' } }, group: 'inbound' },
  { key: 'produce_in', label: '生产入库', filter: { txn_type: { $eq: '生产入库' } }, group: 'inbound' },
  { key: 'return_in', label: '退货入库', filter: { txn_type: { $eq: '退货入库' } }, group: 'inbound' },
  { key: 'gain', label: '盘盈', filter: { txn_type: { $eq: '盘盈' } }, group: 'inbound' },
  { key: 'sales_out', label: '销售出库', filter: { txn_type: { $eq: '销售出库' } }, group: 'outbound' },
  { key: 'produce_out', label: '生产领料', filter: { txn_type: { $eq: '生产领料' } }, group: 'outbound' },
  { key: 'loss', label: '盘亏', filter: { txn_type: { $eq: '盘亏' } }, group: 'outbound' },
];

const ALL_STATS = [...STATS, ...DETAIL_STATS];

function useStats() {
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    try {
      const queries = ALL_STATS.filter((s) => s.filter).map((s) =>
        ctx.api.request({
          url: 'nb_erp_inventory:list',
          params: { pageSize: 1, filter: s.filter },
        }).then((res) => [s.key, res?.data?.meta?.count || 0])
      );

      const totalRes = await ctx.api.request({
        url: 'nb_erp_inventory:list',
        params: { pageSize: 1 },
      });

      const results = await Promise.all(queries);
      const map = { all: totalRes?.data?.meta?.count || 0 };
      results.forEach(([k, v]) => { map[k] = v; });
      setCounts(map);
    } catch (e) {
      console.error('filter_inv_stats: fetch error', e);
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
      console.error('filter_inv_stats: filter error', e);
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
      <Divider type="vertical" />
      {DETAIL_STATS.map((stat) => (
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
