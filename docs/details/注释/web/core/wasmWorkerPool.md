# wasmWorkerPool.ts 详细注释

> 来源：`apps/web/src/core/wasmWorkerPool.ts`
> 说明：本文件为 WASM Worker 池内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 6-22 行）

```
/**
 * WASM Worker 池 — 管理多个 Web Worker 执行 WASM 重计算
 *
 * 设计要点：
 * 1. 懒初始化 — 首次调用时创建 Worker
 * 2. 任务队列 — Worker 忙时自动排队，空闲后按序消费
 * 3. 自动回退 — Worker 创建失败或 WASM 加载失败时，回退到主线程同步调用
 * 4. 可取消 — 返回 Promise，支持 AbortController 取消（标记忽略结果）
 *
 * 标记为"重计算"的方法走 Worker，轻量方法仍在主线程：
 * - Heavy: algoForceLayout, algoDijkstraPath, algoAstar, algoTopologicalSort,
 *   algoConnectedComponents, algoTarjanScc, algoPageRank, algoCommunityDetection,
 *   algoBetweennessCentrality, algoTerrainHeightmapGenerate, algoHydraulicErosion,
 *   algoViewshed, algoConstraintSolve, runDiagnostics, validatePack,
 *   algoDxfParse, algoPolygonBoolean
 * - Light (主线程): algoSegmentIntersect, algoPointInPolygon, algoPolygonArea, etc.
 */
```
