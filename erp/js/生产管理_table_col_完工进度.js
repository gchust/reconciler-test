const { Progress, Space, Typography } = ctx.antd;
const { Text } = Typography;
const { completed_qty, planned_qty } = ctx.record;

const completed = completed_qty ?? 0;
const planned = planned_qty ?? 0;

const percent = planned > 0 ? Math.round((completed / planned) * 100) : 0;

let color;
if (percent < 50) {
  color = '#f5222d';
} else if (percent < 80) {
  color = '#fa8c16';
} else {
  color = '#52c41a';
}

ctx.render(
  <Space direction="vertical" size={0} style={{ width: '100%' }}>
    <Progress
      percent={percent}
      size="small"
      strokeColor={color}
      showInfo={false}
      style={{ marginBottom: 2 }}
    />
    <Text style={{ fontSize: 12 }}>
      {completed.toLocaleString()}/{planned.toLocaleString()} ({percent}%)
    </Text>
  </Space>
);
