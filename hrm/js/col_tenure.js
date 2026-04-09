/**
 * Tenure — Years+months since hire_date
 * @type JSColumnModel
 * @collection hrm_employees
 * @fields hire_date
 */
const { Tag } = ctx.antd;
const r = ctx.record;
const hireDate = r.hire_date;

if (!hireDate) {
  ctx.render(<Tag color="default">N/A</Tag>);
} else {
  const now = ctx.libs.dayjs();
  const hire = ctx.libs.dayjs(hireDate);
  const years = now.diff(hire, 'year');
  const months = now.diff(hire, 'month') % 12;

  if (years >= 5) {
    ctx.render(<Tag color="gold">{years}y {months}m</Tag>);
  } else if (years >= 2) {
    ctx.render(<Tag color="green">{years}y {months}m</Tag>);
  } else if (years >= 1) {
    ctx.render(<Tag color="blue">{years}y {months}m</Tag>);
  } else {
    ctx.render(<Tag color="default">{months}m</Tag>);
  }
}
