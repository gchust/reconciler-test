var data = ctx.data.objects || [];
return {
  title: { left: 'center', textStyle: { fontSize: 14 } },
  tooltip: { trigger: 'item' },
  legend: { bottom: 0 },
  series: [
    {
      type: 'pie',
      radius: ['35%', '70%'],
      data: data.map(function (d) {
        return { name: d.label, value: d.value };
      })
    }
  ]
};
