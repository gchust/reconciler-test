const { Tag } = ctx.antd;
const { standard_price, cost_price } = ctx.record;

const price = standard_price ?? 0;
const cost = cost_price ?? 0;

if (!price) {
  ctx.render(<Tag color="gray">N/A</Tag>);
  return;
}

const rate = ((price - cost) / price) * 100;
const display = rate.toFixed(1) + '%';

let color;
if (rate < 10) {
  color = 'red';
} else if (rate < 20) {
  color = 'orange';
} else {
  color = 'green';
}

ctx.render(<Tag color={color}>{display}</Tag>);
