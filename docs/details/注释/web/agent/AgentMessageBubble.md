# AgentMessageBubble.vue 详细注释

> 来源：`apps/web/src/agent/AgentMessageBubble.vue`
> 说明：本文件为 AgentMessageBubble 组件内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 35-57 行）

```
/**
 * AgentMessageBubble：消息气泡路由分发器
 *
 * 重构说明：原 1614 行单文件已拆分为多个子组件，本文件仅负责：
 * 1. 接收原始 props/emits（API 完全不变）
 * 2. 计算 hasVisibleContent / chatMode / isDeepMode 三个路由分支条件
 * 3. 按四种情况分发渲染：
 *    - turn-separator（轮次分隔线）
 *    - time-divider（时间分隔线）
 *    - DeepMessageArea（深度思考模式）
 *    - NormalMessageBubble（普通气泡模式）
 *
 * 子组件目录：./bubbles/
 *   - DeepMessageArea.vue    深度模式完整 UI
 *   - NormalMessageBubble.vue 普通模式完整 UI
 *   - MessageBlocks.vue       Block 渲染容器
 *   - types.ts                共享类型（AgentMessage / ChatMode / BlockActionEvent ...）
 *   - toolLabels.ts           工具名→中文标签字典 + getToolLabel
 *   - deepPhases.ts           深度模式阶段定义 + PhaseGroup
 *   - useMarkdownRender.ts    marked + DOMPurify + 实体 mention 注入 composable
 *   - useMessageExport.ts     图片/GIF 导出 composable
 *   - format.ts               formatTime / formatActivityTime
 */
```
