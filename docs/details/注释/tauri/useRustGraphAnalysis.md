# useRustGraphAnalysis.ts 详细注释文档（tauri）

> 来源：`apps/tauri/src/plugins/mindmap/composables/useRustGraphAnalysis.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 6-18 行）

Rust 图分析算法桥接

将前端图数据序列化后通过 Tauri invoke 调用 worldsea-core 的图算法：
- 最短路径 (Dijkstra)
- 连通分量
- PageRank
- 社区检测 (Louvain)
- 悬空节点检测

Web 环境回退到纯 JS 实现。
