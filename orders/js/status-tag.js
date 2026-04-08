/**
 * 订单状态标签列
 */
const record = ctx.record;
const status = record?.status || '';

const colors = {
  '待确认': 'orange',
  '已确认': 'blue',
  '生产中': 'geekblue',
  '已发货': 'cyan',
  '已完成': 'green',
  '已取消': 'red',
};

const { Tag } = ctx.antd;
ctx.render(<Tag color={colors[status] || 'default'}>{status}</Tag>);
