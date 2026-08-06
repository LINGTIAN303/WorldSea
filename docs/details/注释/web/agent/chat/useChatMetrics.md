# useChatMetrics.ts 详细注释

> 来源：`apps/web/src/agent/chat/useChatMetrics.ts`
> 说明：本文件为 useChatMetrics composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-10 行）

```
/**
 * useChatMetrics — 聊天上下文用量 / 成本 / 归档阈值计算
 *
 * 从 AgentChat.vue 拆分而来，负责：
 *   - contextUsage：上下文窗口占用百分比
 *   - calculatedCost：基于模型费率和总用量的成本估算
 *   - archiveThreshold / archiveThresholdPct：H3.3 归档阈值在进度条上的位置
 *   - contextBarTitle：增强 tooltip（含归档阈值提示）
 *   - hasVisionSubAgent：是否具备视觉子 Agent
 */
```
