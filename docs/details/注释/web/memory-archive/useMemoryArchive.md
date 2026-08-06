# useMemoryArchive.ts 详细注释

> 来源：`apps/web/src/memory-archive/useMemoryArchive.ts`
> 说明：本文件为 useMemoryArchive composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-18 行）

```
/**
 * useMemoryArchive - 记忆库集成 composable
 *
 * 将 @worldsmith/memory-archive 框架集成到 worldsmith 宿主环境。
 * 管理 ArchiveManager 的生命周期，提供归档/检索 API。
 *
 * 工作流程：
 * 1. 应用启动时调用 init()，创建 ArchiveManager 并初始化
 * 2. ArchiveManager.init() 创建归档工具，通过 AgentBridgeImpl.registerTools() 传递
 * 3. 归档工具通过 archiveToolsRegistry 注册，供 useAgent.ensureInitialized() 获取
 * 4. 项目切换时调用 switchProject()，重新初始化 ArchiveManager
 * 5. 应用关闭时调用 dispose()，清理资源
 *
 * 依赖：
 * - Tauri 环境（需要文件系统支持）
 * - 项目关联目录（basePath = {项目目录}/.worldsmith/memory-archive/）
 * - useAgent 已初始化（AgentBridge 需要访问 messages）
 */
```

## 注释块 2（原文件第 288-297 行）

```
/**
 * 切换会话
 *
 * P3-2-3 新增：会话切换时更新 ArchiveManager 的 sessionId，并重置 boundary。
 * 不重新初始化 ArchiveManager，复用已加载的钩子缓存和适配器。
 *
 * 在 useArchiveTriggers 的 watch currentSessionId 中调用。
 *
 * @param newSessionId 新的会话 ID
 */
```

## 注释块 3（原文件第 307-319 行）

```
/**
 * H2.1 自动注入最近钩子摘要
 *
 * 按原设计文档 autoInjectRecentCount 配置，在新会话创建或切换到已有会话时，
 * 自动注入最近 N 条钩子摘要到消息上下文，使 Agent 能感知之前的对话关键信息。
 *
 * 注入条件：
 * - 记忆库已初始化
 * - 当前消息列表中不存在已注入的归档摘要（避免重复注入）
 * - autoInjectRecentCount > 0
 *
 * @returns 注入的摘要文本，无注入时返回空字符串
 */
```

## 注释块 4（原文件第 367-376 行）

```
/**
 * H6.2 归档指定会话（删除会话前调用）
 *
 * 从 Agent 会话数据库读取目标会话的完整消息，
 * 转换为 AgentMessageSnapshot 后调用 archiveExternalMessages 归档。
 * 不推进当前会话的 boundary，不向当前会话注入摘要。
 *
 * @param sessionId 目标会话 ID
 * @returns 归档结果，如果消息不足或会话不存在则返回 null
 */
```

## 注释块 5（原文件第 489-499 行）

```
/**
 * 恢复边界（P13 决策）
 *
 * 从 archiveStore（sessionStorage）读取持久化的边界索引，
 * 恢复到 ArchiveManager 的 ArchiveBoundary 中。
 *
 * 使用场景：
 * - useAgent.abort() 重建 agent 后调用
 * - useAgent.ensureInitialized() 初始化后调用
 * - 页面刷新后恢复
 */
```
