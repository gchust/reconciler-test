var data = ctx.data.objects || [];
return {
  title: { left: 'center', textStyle: { fontSize: 14 } },
  tooltip: { trigger: 'item' },
  legend: { orient: 'vertical', right: 0, top: 'middle' },
  series: [
    {
      type: 'pie',
      radius: ['45%', '72%'],
      center: ['35%', '50%'],
      label: { formatter: '{b}: {c}' },
      data: data.map(function (d) {
        return { name: d.label, value: d.value };
      })
    }
  ]
};
