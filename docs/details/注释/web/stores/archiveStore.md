# archiveStore.ts 详细注释

> 来源：`apps/web/src/stores/archiveStore.ts`
> 说明：本文件为归档边界状态 store 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-20 行）

```
/**
 * archiveStore - 归档边界状态管理（P13 决策）
 *
 * 使用 Pinia store + sessionStorage 持久化归档边界索引。
 * 设计文档 5.4 节要求：归档边界需在 abort 重建 agent 后恢复，
 * 在 clearHistory 时重置，在页面刷新后仍可读取。
 *
 * H1.1 修复：archivedBoundaryIndex 改为累计语义。
 * 每次 setBoundary 传入"本次归档的消息数"，store 累加到已有值。
 * resetBoundary（clearHistory）清零；restoreBoundary 从 sessionStorage 读取累计值。
 *
 * sessionStorage key: 'archive:boundary'
 *
 * 使用场景：
 * - AgentMessageList.vue：根据边界索引分割已归档/活跃消息
 * - useAgent.abort()：重建 agent 后调用 restoreBoundary()
 * - useAgent.clearHistory()：调用 resetBoundary()
 * - useAgent.ensureInitialized()：初始化后调用 restoreBoundary()
 * - useMemoryArchive：归档完成时调用 setBoundary()（传入本次归档数，累加）
 */
```
