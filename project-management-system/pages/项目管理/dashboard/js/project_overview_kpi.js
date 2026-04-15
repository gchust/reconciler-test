const { useEffect, useState } = ctx.React;
const h = ctx.React.createElement;

const card = {
  background: 'linear-gradient(135deg, #f0f7ff 0%, #ffffff 100%)',
  border: '1px solid #d6e4ff',
  borderRadius: '16px',
  padding: '20px 24px',
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: '16px'
};

const itemTitle = { fontSize: '12px', color: '#666', marginBottom: '6px' };
const itemValue = { fontSize: '28px', fontWeight: 700, color: '#1677ff' };

function OverviewKpi() {
  const [stats, setStats] = useState({
    projects: 0,
    activeTasks: 0,
    milestones: 0,
    hours: 0,
  });

  useEffect(() => {
    (async () => {
      try {
        const [projects, tasks, milestones, hours] = await Promise.all([
          ctx.api.request({ url: 'nb_pm_projects:list', params: { pageSize: 1 } }),
          ctx.api.request({ url: 'nb_pm_tasks:list', params: { pageSize: 1, filter: { status: { $in: ['todo', 'in_progress', 'blocked'] } } } }),
          ctx.api.request({ url: 'nb_pm_milestones:list', params: { pageSize: 1, filter: { status: { $in: ['pending', 'in_progress', 'delayed'] } } } }),
          ctx.api.request({ url: 'nb_pm_time_entries:list', params: { pageSize: 200 } }),
        ]);

        var totalHours = ((hours && hours.data && hours.data.data) || []).reduce(function (sum, item) {
          return sum + Number(item.hours || 0);
        }, 0);

        setStats({
          projects: projects?.data?.meta?.count || 0,
          activeTasks: tasks?.data?.meta?.count || 0,
          milestones: milestones?.data?.meta?.count || 0,
          hours: totalHours,
        });
      } catch (error) {
        console.error('project_overview_kpi error', error);
      }
    })();
  }, []);

  return h('div', { style: card }, [
    h('div', { key: 'projects' }, [h('div', { style: itemTitle }, '项目总数'), h('div', { style: itemValue }, String(stats.projects))]),
    h('div', { key: 'tasks' }, [h('div', { style: itemTitle }, '待处理任务'), h('div', { style: itemValue }, String(stats.activeTasks))]),
    h('div', { key: 'milestones' }, [h('div', { style: itemTitle }, '进行中里程碑'), h('div', { style: itemValue }, String(stats.milestones))]),
    h('div', { key: 'hours' }, [h('div', { style: itemTitle }, '累计工时'), h('div', { style: itemValue }, String(stats.hours))]),
  ]);
}

ctx.render(h(OverviewKpi));
