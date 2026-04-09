/**
 * Employee Stats Filter
 *
 * @type JSItemModel
 * @template filter-stats
 */

const TARGET_BLOCK_UID = '__TABLE_UID__';

// ─── CONFIG: AI modifies here ────────────────────────────────
const COLLECTION = 'hrm_employees';

const GROUPS = [
  {
    name: 'Status',
    items: [
      { key: 'all', label: 'All', filter: null },
      { key: 'active', label: 'Active', filter: { status: { $eq: 'Active' } } },
      { key: 'on_leave', label: 'On Leave', filter: { status: { $eq: 'On Leave' } } },
      { key: 'resigned', label: 'Resigned', filter: { status: { $eq: 'Resigned' } }, danger: true },
      { key: 'terminated', label: 'Terminated', filter: { status: { $eq: 'Terminated' } }, danger: true },
    ],
  },
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
