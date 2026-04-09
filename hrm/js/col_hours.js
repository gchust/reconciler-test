/**
 * Work Hours Indicator Tag
 * @type JSColumnModel
 * @collection hrm_attendance
 * @fields work_hours, overtime_hours, status
 */
const { Tag, Space } = ctx.antd;
const r = ctx.record;
const hours = parseFloat(r.work_hours) || 0;
const overtime = parseFloat(r.overtime_hours) || 0;
const status = r.status;

if (status === 'Absent' || status === 'Leave' || status === 'Holiday') {
  ctx.render(<Tag color={status === 'Absent' ? 'red' : 'blue'}>{status}</Tag>);
} else if (hours >= 8) {
  ctx.render(
    <Space size={4}>
      <Tag color="green">{hours}h</Tag>
      {overtime > 0 && <Tag color="gold">+{overtime}h OT</Tag>}
    </Space>
  );
} else if (hours >= 4) {
  ctx.render(<Tag color="orange">{hours}h</Tag>);
} else {
  ctx.render(<Tag color="red">{hours}h</Tag>);
}
