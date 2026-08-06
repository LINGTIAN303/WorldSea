# ArchiveConfigPanel.vue 详细注释

> 来源：`apps/web/src/agent/ArchiveConfigPanel.vue`
> 说明：本文件为 ArchiveConfigPanel 组件内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 405-421 行）

```
/**
 * ArchiveConfigPanel - 归档参数配置面板
 *
 * P3-4-2 新增：提供归档参数的可视化配置界面。
 *
 * 配置项分组：
 * 1. 归档触发：阈值、最小消息数、3 个触发开关
 * 2. 衰减策略：半衰期、淘汰阈值、硬删除天数
 * 3. 注入策略：自动注入数、最大摘要 tokens
 * 4. 分块策略：最小/最大块 tokens
 * 5. 摘要配置：启用开关、方式、最大长度
 * 6. Embedding：模型、维度、批大小
 * 7. 存储限制：最大钩子数、最大存储 MB
 * 8. 排除模式：正则表达式列表
 *
 * 保存时通过 useMemoryArchive.saveConfig 持久化到 localStorage。
 */
```
