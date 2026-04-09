/**
 * Salary Band Tag — by salary range
 * @type JSColumnModel
 * @collection hrm_employees
 * @fields salary
 */
const { Tag } = ctx.antd;
const r = ctx.record;
const salary = parseFloat(r.salary) || 0;

if (salary >= 20000) {
  ctx.render(<Tag color="gold">Senior ({(salary/1000).toFixed(0)}K)</Tag>);
} else if (salary >= 10000) {
  ctx.render(<Tag color="green">Mid ({(salary/1000).toFixed(0)}K)</Tag>);
} else if (salary >= 5000) {
  ctx.render(<Tag color="blue">Junior ({(salary/1000).toFixed(0)}K)</Tag>);
} else {
  ctx.render(<Tag color="default">Entry ({(salary/1000).toFixed(0)}K)</Tag>);
}
