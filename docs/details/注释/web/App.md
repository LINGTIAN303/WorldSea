# App.vue 详细注释

> 来源：`apps/web/src/App.vue`
> 说明：本文件为 App 组件内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 95-106 行）

```
/* ── 调控器启动：按 priority + 依赖拓扑自动激活所有模块 ──
 *
 * 替代 P3-W2 骨架阶段的硬编码 markReady：
 * - critical: 项目空间/WASM 检测/插件预注册
 * - normal: 关系初始化/自定义模块/导航监听（P3-W3；官方插件 P3-W4 恢复）
 * - lazy: 自动清理
 *
 * 分级降级策略：
 * - critical 失败 → hasCriticalFailure=true，显示错误页
 * - normal 失败 → 记录但继续
 * - lazy 失败 → 静默
 */
```
