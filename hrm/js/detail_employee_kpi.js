/**
 * Employee Detail KPI — tenure, salary, department, position, status badge
 * @type JSItemModel
 * @collection hrm_employees
 * @fields hire_date, salary, department, position, status
 */
const { Card, Row, Col, Statistic, Tag, Space } = ctx.antd;
const r = ctx.record;

const salary = parseFloat(r.salary) || 0;
const status = r.status || 'N/A';
const department = r.department || 'N/A';
const position = r.position || 'N/A';
const hireDate = r.hire_date;

let tenureText = 'N/A';
if (hireDate) {
  const now = ctx.libs.dayjs();
  const hire = ctx.libs.dayjs(hireDate);
  const years = now.diff(hire, 'year');
  const months = now.diff(hire, 'month') % 12;
  tenureText = years > 0 ? `${years}y ${months}m` : `${months}m`;
}

const statusColor = status === 'Active' ? 'green' : status === 'On Leave' ? 'orange' : status === 'Resigned' ? 'red' : 'default';

ctx.render(
  <Card size="small" style={{ marginBottom: 12 }}>
    <Row gutter={16}>
      <Col span={6}>
        <Statistic
          title="Department"
          value={department}
          valueStyle={{ fontSize: 16 }}
        />
      </Col>
      <Col span={6}>
        <Statistic
          title="Position"
          value={position}
          valueStyle={{ fontSize: 16 }}
        />
      </Col>
      <Col span={4}>
        <Statistic
          title="Tenure"
          value={tenureText}
          valueStyle={{ fontSize: 16, color: '#3b82f6' }}
        />
      </Col>
      <Col span={4}>
        <Statistic
          title="Salary"
          value={salary}
          precision={0}
          prefix="¥"
          valueStyle={{ fontSize: 16 }}
        />
      </Col>
      <Col span={4}>
        <Space direction="vertical" size={0}>
          <span style={{ color: '#999', fontSize: 12 }}>Status</span>
          <Tag color={statusColor} style={{ marginTop: 4 }}>{status}</Tag>
        </Space>
      </Col>
    </Row>
  </Card>
);
