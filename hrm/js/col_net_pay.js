/**
 * Formatted Net Pay Amount
 * @type JSColumnModel
 * @collection hrm_payroll
 * @fields net_pay
 */
const { Tag } = ctx.antd;
const r = ctx.record;
const netPay = parseFloat(r.net_pay) || 0;

const formatted = netPay >= 10000
  ? `¥${(netPay/10000).toFixed(2)}W`
  : `¥${netPay.toLocaleString()}`;

if (netPay >= 20000) {
  ctx.render(<Tag color="gold">{formatted}</Tag>);
} else if (netPay >= 10000) {
  ctx.render(<Tag color="green">{formatted}</Tag>);
} else if (netPay >= 5000) {
  ctx.render(<Tag color="blue">{formatted}</Tag>);
} else {
  ctx.render(<Tag color="default">{formatted}</Tag>);
}
