const { Typography } = ctx.antd;
const { Text } = Typography;
const { total_amount, tax_amount } = ctx.record;

const total = (total_amount ?? 0) + (tax_amount ?? 0);
const display = '¥' + total.toLocaleString('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

ctx.render(
  <Text strong>{display}</Text>
);
