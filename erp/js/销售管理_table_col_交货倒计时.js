const { Tag } = ctx.antd;
const { delivery_date, status } = ctx.record;

if (status === '已签收') {
  ctx.render(<Tag color="green">✓ 已签收</Tag>);
  return;
}
if (status === '已取消') {
  ctx.render(<Tag color="gray">已取消</Tag>);
  return;
}

if (!delivery_date) {
  ctx.render(<Tag color="default">未设定</Tag>);
  return;
}

const now = new Date();
const target = new Date(delivery_date);
const diffMs = target.getTime() - now.getTime();
const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

let color, label;
if (days < 0) {
  color = 'red';
  label = `逾期 ${Math.abs(days)} 天`;
} else if (days < 3) {
  color = 'orange';
  label = `剩余 ${days} 天`;
} else {
  color = 'blue';
  label = `剩余 ${days} 天`;
}

ctx.render(<Tag color={color}>{label}</Tag>);
