/**
 * Leave Days Count with Color
 * @type JSColumnModel
 * @collection hrm_leave_requests
 * @fields days, leave_type
 */
const { Tag } = ctx.antd;
const r = ctx.record;
const days = parseFloat(r.days) || 0;
const type = r.leave_type || '';

if (days > 3) {
  ctx.render(<Tag color="orange">{days}d ({type})</Tag>);
} else if (days > 1) {
  ctx.render(<Tag color="blue">{days}d ({type})</Tag>);
} else {
  ctx.render(<Tag color="green">{days}d ({type})</Tag>);
}
