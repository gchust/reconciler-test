/**
 * Days Since Posted — recruitment age
 * @type JSColumnModel
 * @collection hrm_recruitment
 * @fields posted_date, status
 */
const { Tag } = ctx.antd;
const r = ctx.record;
const posted = r.posted_date;
const status = r.status;

if (!posted || status === 'Closed' || status === 'Cancelled') {
  ctx.render(<Tag color="default">{status || 'N/A'}</Tag>);
} else {
  const now = ctx.libs.dayjs();
  const postDate = ctx.libs.dayjs(posted);
  const days = now.diff(postDate, 'day');

  if (days > 30) {
    ctx.render(<Tag color="red">{days}d open</Tag>);
  } else if (days > 14) {
    ctx.render(<Tag color="orange">{days}d open</Tag>);
  } else {
    ctx.render(<Tag color="green">{days}d open</Tag>);
  }
}
