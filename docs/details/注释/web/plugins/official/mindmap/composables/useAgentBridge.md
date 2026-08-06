# useAgentBridge.ts 详细注释

> 来源：`apps/web/src/plugins/official/mindmap/composables/useAgentBridge.ts`
> 说明：本文件为 Mindmap ↔ AI Agent 通信桥内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-17 行）

```
/**
 * Mindmap ↔ AI Agent 通信桥
 *
 * 通过 window CustomEvent 实现双向通信：
 * - 接收 Agent 的 plugin-action 事件：autoLayout / findIsolated / findCycles / highlightPath / suggestMoveToGroup
 * - 接收 Agent 的 plugin-query 事件：getStructure
 *
 * Action 协议：
 *  - event.action === 'auto_layout': { algorithm: LayoutAlgorithmType }
 *  - event.action === 'find_isolated': {}           → 高亮孤立节点
 *  - event.action === 'find_cycles': {}             → 高亮环上的节点
 *  - event.action === 'highlight_path': { sourceId, targetId } → 高亮路径
 *  - event.action === 'suggest_move_to_group': { nodeId, groupId } → 移动建议
 *  - event.action === 'ai_organize': {}              → 打开 AI 面板 + 触发自动布局
 *  - event.action === 'select_node': { nodeId }
 *  - event.action === 'fit_view': {}
 */
```
