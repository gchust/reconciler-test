/**
 * Budget Utilization — Progress bar (headcount * avg salary vs budget)
 * @type JSColumnModel
 * @collection hrm_departments
 * @fields headcount, budget
 */
const { Progress, Tag } = ctx.antd;
const r = ctx.record;
const headcount = parseInt(r.headcount) || 0;
const budget = parseFloat(r.budget) || 0;

if (budget <= 0) {
  ctx.render(<Tag color="default">No Budget</Tag>);
} else {
  const avgSalary = 12000;
  const estimated = headcount * avgSalary;
  const pct = Math.min(Math.round((estimated / budget) * 100), 100);
  const color = pct >= 90 ? '#ff4d4f' : pct >= 70 ? '#faad14' : '#52c41a';

  ctx.render(
    <Progress
      percent={pct}
      size="small"
      strokeColor={color}
      format={() => `${pct}%`}
      style={{ width: 100 }}
    />
  );
}
