# useArchiveTriggers.ts 详细注释

> 来源：`apps/web/src/memory-archive/useArchiveTriggers.ts`
> 说明：本文件为 useArchiveTriggers composable 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-25 行）

```
/**
 * useArchiveTriggers - 归档触发机制 composable
 *
 * P3-2-3 新增：通过观察 useAgent 状态变化来触发归档，最小化对 useAgent.ts 的侵入。
 *
 * 5 个触发机制：
 * 1. 初始化：watch useAgent.isInitialized，agent 初始化后自动初始化 useMemoryArchive
 * 2. session_end：watch isStreaming: true→false，agent 响应结束时触发归档
 * 3. token 阈值：setInterval 定时检查当前消息历史的 token 估算值
 * 4. 会话切换：watch currentSessionId，更新 ArchiveManager 的 sessionId + 重置 boundary
 * 5. 项目切换：监听 window 'project:switched' 事件，重新初始化 ArchiveManager
 *
 * 设计原则：
 * - 最小侵入 useAgent.ts（不修改 useAgent 的核心逻辑）
 * - 观察者模式（通过 watch 状态变化触发）
 * - 容错（归档失败不影响主流程，所有触发器都有 try-catch）
 * - 幂等（ArchiveManager 内部有读写锁和预检查）
 *
 * 使用方式：
 * ```ts
 * const { start, stop } = useArchiveTriggers()
 * start()  // 开始监听
 * stop()   // 停止监听（组件卸载时自动调用）
 * ```
 */
```

## 注释块 2（原文件第 49-58 行）

```
/**
 * 监听 useAgent.isInitialized 和 currentProject，两者都就绪后初始化 useMemoryArchive
 *
 * useMemoryArchive.init() 依赖：
 * - useAgent.currentSessionId（需要 useAgent 已初始化）
 * - useProjectSwitcher().currentProject（需要项目已加载）
 *
 * 两者初始化顺序不确定，所以同时 watch，当两者都满足条件时调用 handleInit()。
 * 使用 immediate: true 处理两者都已就绪的情况（如热重载）。
 */
```

## 注释块 3（原文件第 272-286 行）

```
/**
 * H1.4：计算动态归档触发点
 *
 * 在 [thresholdMin, thresholdMax] 区间内，根据用户消息占比动态决定触发点：
 * - 用户消息占比高 → 触发点接近 max（延迟归档，保护用户重要对话）
 * - 用户消息占比低（工具/agent 输出多）→ 触发点接近 min（提前归档，释放上下文）
 *
 * 公式：dynamicThreshold = min + (max - min) * userRatio
 * 其中 userRatio = 用户消息字符数 / 总字符数
 *
 * @param messages 当前消息列表
 * @param thresholdMin 阈值下限
 * @param thresholdMax 阈值上限
 * @returns 动态触发点 token 数
 */
```
