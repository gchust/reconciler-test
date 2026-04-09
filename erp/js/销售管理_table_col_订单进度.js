const { Steps, Typography } = ctx.antd;
const { Text } = Typography;
const { status } = ctx.record;

if (status === '已取消') {
  ctx.render(
    <Text type="secondary" delete>已取消</Text>
  );
  return;
}

const steps = ['草稿', '已确认', '生产中', '待发货', '已发货', '已签收'];
const currentIndex = steps.indexOf(status);

const items = steps.map((s) => ({ title: s }));

ctx.render(
  <Steps
    size="small"
    current={currentIndex >= 0 ? currentIndex : 0}
    items={items}
    style={{ maxWidth: 480 }}
  />
);
