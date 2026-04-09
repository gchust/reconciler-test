const { Tag } = ctx.antd;
const { pass_qty, sample_qty } = ctx.record;

const pass = pass_qty ?? 0;
const sample = sample_qty ?? 0;

if (sample <= 0) {
  ctx.render(<Tag color="gray">N/A</Tag>);
  return;
}

const rate = (pass / sample) * 100;
const display = rate.toFixed(1) + '%';

let color;
if (rate < 90) {
  color = 'red';
} else if (rate < 95) {
  color = 'orange';
} else {
  color = 'green';
}

ctx.render(<Tag color={color}>合格率 {display}</Tag>);
