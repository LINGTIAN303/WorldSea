# useLongTaskProgress.ts 详细注释

> 来源：`apps/web/src/agent/chat/useLongTaskProgress.ts`
> 说明：本文件为 useLongTaskProgress composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-10 行）

```
/**
 * useLongTaskProgress — 长任务进度反馈（时长计时器 + 心跳提示）
 *
 * 从 AgentChat.vue 拆分而来，负责：
 *   - 每秒更新 longTaskNow 以驱动 elapsedSec 计算
 *   - 心跳状态文本（heartbeatTitle）
 *   - formatElapsed 工具函数
 *
 * 仅当 hasActiveTask 为 true 时计时器运行，组件卸载时清理。
 */
```
