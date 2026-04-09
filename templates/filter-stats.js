/**
 * Filter Stats Button Group Block Template
 *
 * @type JSItemModel
 * @template filter-stats
 *
 * === AI Modification Guide ===
 * 1. Modify COLLECTION (collection name)
 * 2. Modify GROUPS (button group definitions)
 *    - key: unique identifier
 *    - label: button text
 *    - filter: NocoBase filter condition (null = all)
 *    - danger: true shows red
 * 3. You can have multiple groups (separated by Divider)
 * 4. Do not modify useStats/StatsFilter components — they are generic
 * ====================
 */

const TARGET_BLOCK_UID = '__TABLE_UID__';

// ─── CONFIG: AI modifies here ────────────────────────────────
const COLLECTION = 'nb_erp_products';

const GROUPS = [
  // Group 1: by status
  {
    name: '状态',
    items: [
      { key: 'all', label: '全部', filter: null },
      { key: 'active', label: '有效', filter: { status: { $eq: '有效' } } },
      { key: 'dev', label: '开发中', filter: { status: { $eq: '开发中' } } },
      { key: 'disabled', label: '停用', filter: { status: { $eq: '停用' } } },
    ],
  },
  // Group 2 (optional): special filters
  // {
  //   name: '预警',
  //   items: [
  //     { key: 'low_stock', label: '低库存', filter: { stock_qty: { $lt: 10 } }, danger: true },
  //   ],
  // },
];
// ─── CONFIG END ────────────────────────────────────

// ─── Do not modify below ─────────────────────────────────────
const { useState, useEffect, useCallback } = ctx.React;
const { Button, Badge, Space, Spin, Divider } = ctx.antd;

function useStats() {
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchCounts = useCallback(async () => {
    setLoading(true);
    try {
      const allItems = GROUPS.flatMap(g => g.items);
      const results = await Promise.all(
        allItems.map(item =>
          ctx.api.request({
            url: `${COLLECTION}:list`,
            params: {
              pageSize: 1,
              ...(item.filter && { filter: item.filter }),
            },
          })
        )
      );
      const c = {};
      allItems.forEach((item, i) => {
        c[item.key] = results[i]?.data?.meta?.count || 0;
      });
      setCounts(c);
    } catch (e) {
      console.error('Stats fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);
  return { counts, loading };
}

const StatsFilter = () => {
  const { counts, loading } = useStats();
  const [active, setActive] = useState('all');

  const handleClick = useCallback(async (item) => {
    setActive(item.key);
    try {
      const target = ctx.engine?.getModel(TARGET_BLOCK_UID);
      if (!target) return;
      target.resource.addFilterGroup(ctx.model.uid, item.filter || { $and: [] });
      await target.resource.refresh();
    } catch (e) {
      console.error('Filter error:', e);
    }
  }, []);

  if (loading) return (<Spin size="small" />);

  const renderGroup = (group, idx) => (
    <Space key={idx} wrap size={[6, 6]}>
      {group.items.map(item => (
        <Badge key={item.key} count={counts[item.key] ?? 0} overflowCount={9999} offset={[6, 0]}>
          <Button
            type={active === item.key ? 'primary' : 'default'}
            size="small"
            danger={item.danger}
            onClick={() => handleClick(item)}
          >
            {item.label}
          </Button>
        </Badge>
      ))}
    </Space>
  );

  return (
    <Space wrap size={[8, 8]} split={GROUPS.length > 1 ? <Divider type="vertical" style={{ margin: 0 }} /> : null}>
      {GROUPS.map((group, idx) => renderGroup(group, idx))}
    </Space>
  );
};

ctx.render(<StatsFilter />);
