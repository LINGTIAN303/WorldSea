# algo-tools.ts 详细注释文档（packages/agent-runtime/tools）

> 来源：`packages/agent-runtime/src/tools/algo-tools.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 4-18 行）

```
算法工具集

通过 Tauri 后端调用 Rust 核心库的算法引擎，提供：
- 空间索引算法 (R-Tree): 插入/查询/清空
- 几何算法: 线段求交、点在多边形内、多边形度量、凸包、碰撞检测
- 图算法: 最短路径、拓扑排序、图分析、力导向布局、PageRank、社区发现
- CRDT 算法: LWW-Register、OR-Set、RGA、Vector Clock
- 地形算法: 噪声生成、高度图、等高线、水力侵蚀、视域分析
- 约束求解: 约束求解、DXF 解析/生成/提取约束
- 多边形布尔操作: 并/交/差、偏移
- 曲线平滑: Chaikin 平滑

所有工具依赖 Tauri invoke API，仅在 Tauri 桌面模式下可用。
```
