# archiveToolsRegistry.ts 详细注释

> 来源：`apps/web/src/memory-archive/archiveToolsRegistry.ts`
> 说明：本文件为归档工具注册表内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-13 行）

```
/**
 * 归档工具注册表
 *
 * 在 useMemoryArchive 和 useAgent 之间传递归档工具。
 *
 * 工作流程：
 * 1. useMemoryArchive 初始化时，ArchiveManager.init() 创建归档工具
 * 2. AgentBridgeImpl.registerTools() 通过 onToolsReady 回调将工具传递给 useMemoryArchive
 * 3. useMemoryArchive 将 ArchiveTool 转换为 ToolDefinition，调用 registerArchiveTools()
 * 4. useAgent.ensureInitialized() 通过 getArchiveTools() 获取工具，加入到 mainTools
 *
 * 如果 useAgent 已初始化（动态注册场景），通过 useAgent 的 registerDynamicTools() 方法注册。
 */
```
