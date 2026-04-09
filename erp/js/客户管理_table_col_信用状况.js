const { Badge, Space, Typography } = ctx.antd;
const { Text } = Typography;
const { level, credit_limit } = ctx.record;

const colorMap = {
  VIP: 'gold',
  A: 'blue',
  B: 'green',
  C: 'gray',
};

const badgeColor = colorMap[level] || 'gray';
const amount = (credit_limit ?? 0).toLocaleString('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  minimumFractionDigits: 0,
});

ctx.render(
  <Space size={8}>
    <Badge color={badgeColor} text={level || '-'} />
    <Text type="secondary">{amount}</Text>
  </Space>
);
