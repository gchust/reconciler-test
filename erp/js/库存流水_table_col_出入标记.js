const { Tag } = ctx.antd;
const { txn_type } = ctx.record;

const inbound = ['采购入库', '生产入库', '退货入库', '盘盈'];
const outbound = ['销售出库', '生产领料', '盘亏'];
const transfer = ['调拨'];

let color, icon, label;
if (inbound.includes(txn_type)) {
  color = 'green';
  icon = '↑';
  label = '入库';
} else if (outbound.includes(txn_type)) {
  color = 'red';
  icon = '↓';
  label = '出库';
} else if (transfer.includes(txn_type)) {
  color = 'blue';
  icon = '↔';
  label = '调拨';
} else {
  color = 'default';
  icon = '';
  label = txn_type || '-';
}

ctx.render(
  <Tag color={color}>{icon} {label}</Tag>
);
