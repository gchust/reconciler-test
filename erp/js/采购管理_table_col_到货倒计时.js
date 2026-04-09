const { Tag } = ctx.antd;
const { expected_date, status } = ctx.record;

if (status === '已到货') {
  ctx.render(<Tag color="green">✓ 已到货</Tag>);
  return;
}
if (status === '已取消') {
  ctx.render(<Tag color="gray">已取消</Tag>);
  return;
}
if (status === '已关闭') {
  ctx.render(<Tag color="gray">已关闭</Tag>);
  return;
}

if (!expected_date) {
  ctx.render(<Tag color="default">未设定</Tag>);
  return;
}

const now = new Date();
const target = new Date(expected_date);
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
