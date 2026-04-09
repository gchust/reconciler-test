const { Tag, Space } = ctx.antd;
const { stock_qty, min_stock } = ctx.record;

const qty = stock_qty ?? 0;
const min = min_stock ?? 0;

let color, label;
if (qty <= 0) {
  color = 'red';
  label = '缺货';
} else if (qty < min) {
  color = 'red';
  label = '低于安全库存';
} else if (qty < min * 2) {
  color = 'orange';
  label = '偏低';
} else {
  color = 'green';
  label = '充足';
}

ctx.render(
  <Space size={4}>
    <Tag color={color}>{label}</Tag>
    <span>{qty.toLocaleString()}</span>
  </Space>
);
