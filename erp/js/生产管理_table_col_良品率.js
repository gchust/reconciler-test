const { Tag } = ctx.antd;
const { completed_qty, defect_qty } = ctx.record;

const completed = completed_qty ?? 0;
const defect = defect_qty ?? 0;

if (completed <= 0) {
  ctx.render(<Tag color="gray">N/A</Tag>);
  return;
}

const yieldRate = ((completed - defect) / completed) * 100;
const display = yieldRate.toFixed(1) + '%';

let color;
if (yieldRate < 90) {
  color = 'red';
} else if (yieldRate < 95) {
  color = 'orange';
} else {
  color = 'green';
}

ctx.render(<Tag color={color}>良率 {display}</Tag>);
