/**
 * Product Stats Filter
 */
const TARGET_BLOCK_UID = '__TABLE_UID__';
const { useState, useEffect } = ctx.React;
const { Button, Badge, Space, Spin } = ctx.antd;

const STATS = [
  { key: 'all', label: '全部', filter: null },
  { key: 'active', label: '在售', filter: { status: '在售' } },
  { key: 'dev', label: '开发中', filter: { status: '开发中' } },
  { key: 'stopped', label: '停产', filter: { status: '停产' } },
];

function useStats() {
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const results = await Promise.all(
          STATS.map(s => ctx.api.request({
            url: 'erp_products:list',
            params: { pageSize: 1, ...(s.filter && { filter: JSON.stringify(s.filter) }) },
          }))
        );
        const c = {};
        STATS.forEach((s, i) => { c[s.key] = results[i]?.data?.meta?.count || 0; });
        setCounts(c);
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, []);
  return { counts, loading };
}

const StatsFilter = () => {
  const { counts, loading } = useStats();
  const [active, setActive] = useState('all');

  const handleClick = async (stat) => {
    setActive(stat.key);
    try {
      const target = ctx.engine?.getModel(TARGET_BLOCK_UID);
      if (!target) return;
      target.resource.addFilterGroup(ctx.model.uid, stat.filter || { $and: [] });
      await target.resource.refresh();
    } catch (e) { console.error(e); }
  };

  if (loading) return <Spin size="small" />;
  return (
    <Space wrap size={[8, 8]}>
      {STATS.map(s => (
        <Button key={s.key} type={active === s.key ? 'primary' : 'default'} onClick={() => handleClick(s)}>
          {s.label}{' '}
          <Badge count={counts[s.key] ?? 0} showZero overflowCount={9999}
            style={{ marginLeft: 4,
              backgroundColor: active === s.key ? '#fff' : '#f0f0f0',
              color: active === s.key ? '#1677ff' : 'rgba(0,0,0,0.65)',
              boxShadow: 'none' }} />
        </Button>
      ))}
    </Space>
  );
};

ctx.render(<StatsFilter />);
