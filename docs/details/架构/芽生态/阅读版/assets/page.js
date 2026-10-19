/* 页面私有图表：入度 / 出度对比。共享 doc.js 只负责 TOC 与 Mermaid。 */
(function () {
  function readRows() {
    const el = document.getElementById("degree-data");
    if (!el) return [];
    try {
      return JSON.parse(el.textContent || "[]");
    } catch (error) {
      console.warn("degree-data 解析失败", error);
      return [];
    }
  }

  function init() {
    const el = document.getElementById("degree-chart");
    const rows = readRows();
    if (!el || !rows.length || !window.echarts) return;

    const chart = window.echarts.init(el, null, { renderer: "canvas" });
    const sorted = rows.slice().sort((a, b) => a.in - b.in);

    chart.setOption({
      animation: false,
      color: ["#2563eb", "#b7791f"],
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value) => value + " 个芽"
      },
      legend: {
        top: 4,
        data: ["入度（被引用）", "出度（引用）"]
      },
      grid: {
        left: 84,
        right: 36,
        top: 46,
        bottom: 26,
        containLabel: true
      },
      xAxis: {
        type: "value",
        name: "不同芽数",
        minInterval: 1,
        splitLine: { lineStyle: { color: "#e6ebf0" } }
      },
      yAxis: {
        type: "category",
        data: sorted.map((row) => row.name),
        axisTick: { show: false }
      },
      series: [
        {
          name: "入度（被引用）",
          type: "bar",
          barMaxWidth: 9,
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          data: sorted.map((row) => row.in)
        },
        {
          name: "出度（引用）",
          type: "bar",
          barMaxWidth: 9,
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          data: sorted.map((row) => row.out)
        }
      ]
    });

    window.addEventListener("resize", () => chart.resize());
  }

  document.addEventListener("DOMContentLoaded", init);
})();
