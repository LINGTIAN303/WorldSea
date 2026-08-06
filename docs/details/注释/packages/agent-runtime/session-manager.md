# manager.ts 详细注释文档（packages/agent-runtime/session）

> 来源：`packages/agent-runtime/src/session/manager.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-14 行）

```
会话管理器

基于 Dexie (IndexedDB) 实现 Agent 会话的持久化存储。
提供会话的 CRUD 操作，以及在删除会话时级联清理 IndexedDB 中的图片数据。

数据库: worldsmith-agent-${projectId} (v2)
表: sessions / agentProfiles / groupSessions

改造说明：
- AgentDB 构造函数接收 projectId，数据库名动态化
- getDb() 从 AgentDbPool 获取当前项目的数据库实例
- 旧的全局数据库 worldsmith-agent 保留用于数据迁移
```

## 注释块 2（原文件第 172-182 行）

```
删除会话及其关联的 IndexedDB 图片

删除流程：
1. 读取会话的所有消息
2. 遍历 messages → blocks，收集所有 type === 'image' 的 block ID
3. 并行调用 deleteImage 清理 IndexedDB 中的图片 blob
4. 删除 Dexie 中的会话记录

使用 Promise.allSettled 确保图片删除失败不影响会话记录删除
```
