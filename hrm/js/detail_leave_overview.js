/**
 * Leave Request Overview — leave type badge, duration, status badge, approver
 * @type JSItemModel
 * @collection hrm_leave_requests
 * @fields leave_type, start_date, end_date, days, status, approver
 */
const { Card, Row, Col, Statistic, Tag, Space } = ctx.antd;
const r = ctx.record;

const leaveType = r.leave_type || 'N/A';
const days = parseFloat(r.days) || 0;
const status = r.status || 'N/A';
const approver = r.approver || 'N/A';
const startDate = r.start_date ? ctx.libs.dayjs(r.start_date).format('YYYY-MM-DD') : 'N/A';
const endDate = r.end_date ? ctx.libs.dayjs(r.end_date).format('YYYY-MM-DD') : 'N/A';

const typeColors = { Annual: 'blue', Sick: 'orange', Personal: 'green', Maternity: 'purple', Unpaid: 'default' };
const statusColors = { Pending: 'gold', Approved: 'green', Rejected: 'red', Cancelled: 'default' };

ctx.render(
  <Card size="small" style={{ marginBottom: 12 }}>
    <Row gutter={16}>
      <Col span={5}>
        <Space direction="vertical" size={0}>
          <span style={{ color: '#999', fontSize: 12 }}>Leave Type</span>
          <Tag color={typeColors[leaveType] || 'default'} style={{ marginTop: 4 }}>{leaveType}</Tag>
        </Space>
      </Col>
      <Col span={5}>
        <Statistic
          title="Duration"
          value={days}
          suffix="days"
          valueStyle={{ fontSize: 16, color: days > 3 ? '#f59e0b' : '#3b82f6' }}
        />
      </Col>
      <Col span={5}>
        <Statistic
          title="Period"
          value={`${startDate} ~ ${endDate}`}
          valueStyle={{ fontSize: 13 }}
        />
      </Col>
      <Col span={5}>
        <Space direction="vertical" size={0}>
          <span style={{ color: '#999', fontSize: 12 }}>Status</span>
          <Tag color={statusColors[status] || 'default'} style={{ marginTop: 4 }}>{status}</Tag>
        </Space>
      </Col>
      <Col span={4}>
        <Statistic
          title="Approver"
          value={approver}
          valueStyle={{ fontSize: 14 }}
        />
      </Col>
    </Row>
  </Card>
);
