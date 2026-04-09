const { Rate, Space, Typography } = ctx.antd;
const { Text } = Typography;
const { delivery_score, quality_score } = ctx.record;

const d = delivery_score ?? 0;
const q = quality_score ?? 0;
const avg = (d + q) / 2;
const stars = avg / 20;

let color;
if (avg < 60) {
  color = '#f5222d';
} else if (avg < 80) {
  color = '#fa8c16';
} else {
  color = '#52c41a';
}

ctx.render(
  <Space size={8}>
    <Rate
      allowHalf
      disabled
      value={stars}
      style={{ color, fontSize: 14 }}
    />
    <Text type="secondary" style={{ fontSize: 12 }}>
      {avg.toFixed(0)}
    </Text>
  </Space>
);
